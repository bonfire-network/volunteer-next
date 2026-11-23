const HOST = 'https://pretix.example.com';
const API_KEY = 'test-token';

type Env = { host?: string; apiKey?: string };

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

const setEnv = (name: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

/** Re-import the service with a specific environment. */
const load = async (env: Env = {}) => {
  // `in` rather than destructuring defaults: an explicit `undefined` must
  // mean "unset", not "fall back to the default".
  const host = 'host' in env ? env.host : HOST;
  const apiKey = 'apiKey' in env ? env.apiKey : API_KEY;
  jest.resetModules();
  setEnv('PRETIX_HOST', host);
  setEnv('PRETIX_API_KEY', apiKey);
  return import('./pretix-service');
};

/** A Pretix-style paginated response body. */
const page = <T>(results: T[], next: string | null = null) => ({
  count: results.length,
  next,
  previous: null,
  results
});

type FakeResponse = Pick<Response, 'ok' | 'status' | 'statusText' | 'json'>;

const fakeResponse = (
  body: unknown,
  { status = 200, statusText = 'OK' }: { status?: number; statusText?: string } = {}
): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  json: async () => body
});

const json = (body: unknown) => fakeResponse(body);
const failure = (status: number, statusText: string) => fakeResponse({}, { status, statusText });
const invalidJson = (): FakeResponse => ({
  ...fakeResponse(null),
  json: async () => {
    throw new SyntaxError('Unexpected token < in JSON');
  }
});

let fetchMock: jest.Mock;

const installFetch = (mock: jest.Mock) => {
  fetchMock = mock;
  global.fetch = mock as unknown as typeof fetch;
};

/**
 * Route-based fetch mock. Keys are full URLs; values are response bodies
 * (or a function returning a fake response). Unknown URLs fail the test loudly.
 * A fresh response is built per call, since a body can only be read once.
 */
const useRoutes = (routes: Record<string, unknown | (() => FakeResponse)>) =>
  installFetch(
    jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!(url in routes)) {
        throw new Error(`Unexpected fetch to ${url}`);
      }
      const route = routes[url];
      return typeof route === 'function' ? (route as () => FakeResponse)() : json(route);
    })
  );

const calledUrls = () => fetchMock.mock.calls.map(([url]) => String(url));

beforeEach(() => {
  installFetch(jest.fn());
  // The service logs organiser lists at debug level; keep test output clean.
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
  // Restore the environment so tests can't leak into each other.
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe('configuration', () => {
  it('throws when PRETIX_API_KEY is missing, without calling fetch', async () => {
    const { getOrganisers } = await load({ apiKey: undefined });

    await expect(getOrganisers()).rejects.toThrow('PRETIX_API_KEY missing in environment');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when PRETIX_HOST is missing, without calling fetch', async () => {
    const { getOrganisers } = await load({ host: undefined });

    await expect(getOrganisers()).rejects.toThrow('PRETIX_HOST missing in environment');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats empty strings as missing', async () => {
    const { getOrganisers } = await load({ apiKey: '' });

    await expect(getOrganisers()).rejects.toThrow('PRETIX_API_KEY missing in environment');
  });

  it('checks the API key before the host', async () => {
    const { getOrganisers } = await load({ apiKey: undefined, host: undefined });

    await expect(getOrganisers()).rejects.toThrow('PRETIX_API_KEY');
  });
});

describe('request construction', () => {
  it('calls {PRETIX_HOST}/api/v1/{endpoint}', async () => {
    fetchMock.mockResolvedValue(json(page([])));
    const { getOrganisers } = await load();

    await getOrganisers();

    expect(calledUrls()).toEqual([`${HOST}/api/v1/organizers`]);
  });

  it('sends the token and JSON accept headers', async () => {
    fetchMock.mockResolvedValue(json(page([])));
    const { getOrganisers } = await load();

    await getOrganisers();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({
      Authorization: `Token ${API_KEY}`,
      Accept: 'application/json'
    });
  });

  it('uses the env values present at import time', async () => {
    fetchMock.mockResolvedValue(json(page([])));
    const { getOrganisers } = await load({ host: 'https://other.example.org', apiKey: 'abc' });

    await getOrganisers();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://other.example.org/api/v1/organizers');
    expect(init.headers.Authorization).toBe('Token abc');
  });
});

describe('pagination', () => {
  it('returns the results of a single page', async () => {
    const organisers = [{ slug: 'a' }, { slug: 'b' }];
    fetchMock.mockResolvedValue(json(page(organisers)));
    const { getOrganisers } = await load();

    await expect(getOrganisers()).resolves.toEqual(organisers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when there are no results', async () => {
    fetchMock.mockResolvedValue(json(page([])));
    const { getOrganisers } = await load();

    await expect(getOrganisers()).resolves.toEqual([]);
  });

  it('follows `next` links and concatenates pages in order', async () => {
    const p2 = `${HOST}/api/v1/organizers/?page=2`;
    const p3 = `${HOST}/api/v1/organizers/?page=3`;
    useRoutes({
      [`${HOST}/api/v1/organizers`]: page([{ slug: 'a' }, { slug: 'b' }], p2),
      [p2]: page([{ slug: 'c' }], p3),
      [p3]: page([{ slug: 'd' }])
    });
    const { getOrganisers } = await load();

    const result = await getOrganisers();

    expect(result.map((o) => o.slug)).toEqual(['a', 'b', 'c', 'd']);
    expect(calledUrls()).toEqual([`${HOST}/api/v1/organizers`, p2, p3]);
  });

  it('sends the auth header on every page request', async () => {
    const p2 = `${HOST}/api/v1/organizers/?page=2`;
    useRoutes({
      [`${HOST}/api/v1/organizers`]: page([{ slug: 'a' }], p2),
      [p2]: page([{ slug: 'b' }])
    });
    const { getOrganisers } = await load();

    await getOrganisers();

    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers.Authorization).toBe(`Token ${API_KEY}`);
    }
  });

  it('stops when `next` is null', async () => {
    fetchMock.mockResolvedValue(json(page([{ slug: 'a' }], null)));
    const { getOrganisers } = await load();

    await getOrganisers();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects if a later page fails, rather than returning partial data', async () => {
    const p2 = `${HOST}/api/v1/organizers/?page=2`;
    useRoutes({
      [`${HOST}/api/v1/organizers`]: page([{ slug: 'a' }], p2),
      [p2]: () => failure(500, 'Internal Server Error')
    });
    const { getOrganisers } = await load();

    await expect(getOrganisers()).rejects.toThrow(/failed/);
  });
});

describe('error handling', () => {
  it('throws with the URI and status text on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(failure(403, 'Forbidden'));
    const { getOrganisers } = await load();

    await expect(getOrganisers()).rejects.toThrow(
      `Pretix call to ${HOST}/api/v1/organizers failed: 403 Forbidden`
    );
  });

  it('propagates network errors from fetch', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const { getOrganisers } = await load();

    await expect(getOrganisers()).rejects.toThrow('fetch failed');
  });

  it('rejects when the body is not valid JSON', async () => {
    fetchMock.mockResolvedValue(invalidJson());
    const { getOrganisers } = await load();

    await expect(getOrganisers()).rejects.toThrow();
  });
});

describe('getEvents / getCustomers', () => {
  describe('with an organiser slug', () => {
    it('getEvents fetches only that organiser', async () => {
      const events = [{ slug: 'fest-2026' }];
      useRoutes({ [`${HOST}/api/v1/organizers/acme/events`]: page(events) });
      const { getEvents } = await load();

      await expect(getEvents('acme')).resolves.toEqual(events);
      expect(calledUrls()).toEqual([`${HOST}/api/v1/organizers/acme/events`]);
    });

    it('getCustomers fetches only that organiser', async () => {
      const customers = [{ identifier: 'C1' }];
      useRoutes({ [`${HOST}/api/v1/organizers/acme/customers`]: page(customers) });
      const { getCustomers } = await load();

      await expect(getCustomers('acme')).resolves.toEqual(customers);
    });

    it('does not request the organiser list', async () => {
      fetchMock.mockResolvedValue(json(page([])));
      const { getEvents } = await load();

      await getEvents('acme');

      expect(calledUrls()).not.toContain(`${HOST}/api/v1/organizers`);
    });

    it('paginates within the organiser', async () => {
      const p2 = `${HOST}/api/v1/organizers/acme/events/?page=2`;
      useRoutes({
        [`${HOST}/api/v1/organizers/acme/events`]: page([{ slug: 'e1' }], p2),
        [p2]: page([{ slug: 'e2' }])
      });
      const { getEvents } = await load();

      const result = await getEvents('acme');

      expect(result.map((e) => e.slug)).toEqual(['e1', 'e2']);
    });
  });

  describe('without an organiser slug', () => {
    const organisersUrl = `${HOST}/api/v1/organizers`;

    it('fetches organisers first, then each organiser’s events, flattened in organiser order', async () => {
      useRoutes({
        [organisersUrl]: page([{ slug: 'acme' }, { slug: 'globex' }]),
        [`${HOST}/api/v1/organizers/acme/events`]: page([{ slug: 'a1' }, { slug: 'a2' }]),
        [`${HOST}/api/v1/organizers/globex/events`]: page([{ slug: 'g1' }])
      });
      const { getEvents } = await load();

      const result = await getEvents();

      expect(result.map((e) => e.slug)).toEqual(['a1', 'a2', 'g1']);
      expect(calledUrls()[0]).toBe(organisersUrl);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('works for customers too', async () => {
      useRoutes({
        [organisersUrl]: page([{ slug: 'acme' }, { slug: 'globex' }]),
        [`${HOST}/api/v1/organizers/acme/customers`]: page([{ identifier: 'A' }]),
        [`${HOST}/api/v1/organizers/globex/customers`]: page([{ identifier: 'B' }])
      });
      const { getCustomers } = await load();

      const result = await getCustomers();

      expect(result.map((c) => c.identifier)).toEqual(['A', 'B']);
    });

    it('returns an empty array when there are no organisers', async () => {
      useRoutes({ [organisersUrl]: page([]) });
      const { getEvents } = await load();

      await expect(getEvents()).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('treats an empty-string slug as "no organiser"', async () => {
      useRoutes({
        [organisersUrl]: page([{ slug: 'acme' }]),
        [`${HOST}/api/v1/organizers/acme/events`]: page([{ slug: 'a1' }])
      });
      const { getEvents } = await load();

      const result = await getEvents('');

      expect(result).toEqual([{ slug: 'a1' }]);
    });

    it('rejects if any single organiser’s request fails', async () => {
      useRoutes({
        [organisersUrl]: page([{ slug: 'acme' }, { slug: 'globex' }]),
        [`${HOST}/api/v1/organizers/acme/events`]: page([{ slug: 'a1' }]),
        [`${HOST}/api/v1/organizers/globex/events`]: () => failure(500, 'Internal Server Error')
      });
      const { getEvents } = await load();

      await expect(getEvents()).rejects.toThrow(/globex\/events failed/);
    });

    it('rejects if the organiser lookup itself fails', async () => {
      useRoutes({
        [organisersUrl]: () => failure(401, 'Unauthorized')
      });
      const { getEvents } = await load();

      await expect(getEvents()).rejects.toThrow('Unauthorized');
    });
  });
});

describe('getOrders / getOrderPositions', () => {
  it('getOrders requests the event’s orders endpoint', async () => {
    const orders = [{ code: 'ABC12' }];
    useRoutes({ [`${HOST}/api/v1/organizers/acme/events/fest/orders`]: page(orders) });
    const { getOrders } = await load();

    await expect(getOrders('acme', 'fest')).resolves.toEqual(orders);
  });

  it('getOrderPositions requests the event’s orderpositions endpoint', async () => {
    const positions = [{ id: 1 }, { id: 2 }];
    useRoutes({
      [`${HOST}/api/v1/organizers/acme/events/fest/orderpositions`]: page(positions)
    });
    const { getOrderPositions } = await load();

    await expect(getOrderPositions('acme', 'fest')).resolves.toEqual(positions);
  });

  it('getOrders follows pagination', async () => {
    const base = `${HOST}/api/v1/organizers/acme/events/fest/orders`;
    const p2 = `${base}/?page=2`;
    useRoutes({
      [base]: page([{ code: 'A' }], p2),
      [p2]: page([{ code: 'B' }])
    });
    const { getOrders } = await load();

    const result = await getOrders('acme', 'fest');

    expect(result.map((o) => o.code)).toEqual(['A', 'B']);
  });

  it('does not fan out across organisers', async () => {
    fetchMock.mockResolvedValue(json(page([])));
    const { getOrders } = await load();

    await getOrders('acme', 'fest');

    expect(calledUrls()).toEqual([`${HOST}/api/v1/organizers/acme/events/fest/orders`]);
  });
});

describe('hardening', () => {
  describe('pagination origin check', () => {
    it('refuses to follow a `next` URL on a different origin than PRETIX_HOST', async () => {
      useRoutes({
        [`${HOST}/api/v1/organizers`]: page(
          [{ slug: 'a' }],
          'https://evil.example.com/api/v1/organizers/?page=2'
        )
      });
      const { getOrganisers } = await load();

      await expect(getOrganisers()).rejects.toThrow(/redirecting outside/i);
      // The token must never be sent to the foreign host.
      expect(calledUrls()).toEqual([`${HOST}/api/v1/organizers`]);
    });

    it('refuses a `next` URL that downgrades the scheme', async () => {
      useRoutes({
        [`${HOST}/api/v1/organizers`]: page(
          [{ slug: 'a' }],
          'http://pretix.example.com/api/v1/organizers/?page=2'
        )
      });
      const { getOrganisers } = await load();

      await expect(getOrganisers()).rejects.toThrow(/redirecting outside/i);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refuses a different port on the same hostname', async () => {
      useRoutes({
        [`${HOST}/api/v1/organizers`]: page(
          [{ slug: 'a' }],
          'https://pretix.example.com:8443/api/v1/organizers/?page=2'
        )
      });
      const { getOrganisers } = await load();

      await expect(getOrganisers()).rejects.toThrow(/redirecting outside/i);
    });
  });

  describe('slug encoding', () => {
    it('URL-encodes the organiser slug in request paths', async () => {
      useRoutes({
        [`${HOST}/api/v1/organizers/acme%20corp%2F..%2Fadmin/events`]: page([{ slug: 'e' }])
      });
      const { getEvents } = await load();

      await expect(getEvents('acme corp/../admin')).resolves.toEqual([{ slug: 'e' }]);
    });

    it('URL-encodes organiser and event slugs for orders', async () => {
      useRoutes({
        [`${HOST}/api/v1/organizers/o%2F1/events/e%201/orders`]: page([{ code: 'A' }])
      });
      const { getOrders } = await load();

      await expect(getOrders('o/1', 'e 1')).resolves.toEqual([{ code: 'A' }]);
    });

    it('URL-encodes organiser and event slugs for order positions', async () => {
      useRoutes({
        [`${HOST}/api/v1/organizers/o%2F1/events/e%201/orderpositions`]: page([{ id: 1 }])
      });
      const { getOrderPositions } = await load();

      await expect(getOrderPositions('o/1', 'e 1')).resolves.toEqual([{ id: 1 }]);
    });

    it('URL-encodes slugs that came back from the organiser list', async () => {
      useRoutes({
        [`${HOST}/api/v1/organizers`]: page([{ slug: 'we ird' }]),
        [`${HOST}/api/v1/organizers/we%20ird/events`]: page([{ slug: 'e1' }])
      });
      const { getEvents } = await load();

      await expect(getEvents()).resolves.toEqual([{ slug: 'e1' }]);
    });

    it('leaves ordinary slugs unchanged', async () => {
      useRoutes({ [`${HOST}/api/v1/organizers/acme-2026_x/events`]: page([]) });
      const { getEvents } = await load();

      await expect(getEvents('acme-2026_x')).resolves.toEqual([]);
    });
  });

  describe('error detail', () => {
    it('includes the HTTP status code in thrown errors', async () => {
      fetchMock.mockResolvedValue(failure(502, 'Bad Gateway'));
      const { getOrganisers } = await load();

      await expect(getOrganisers()).rejects.toThrow('502 Bad Gateway');
    });

    it('still identifies the failure when statusText is empty (e.g. HTTP/2)', async () => {
      fetchMock.mockResolvedValue(failure(404, ''));
      const { getOrganisers } = await load();

      await expect(getOrganisers()).rejects.toThrow(/404/);
    });
  });

  describe('PRETIX_HOST normalisation', () => {
    it('ignores a single trailing slash', async () => {
      fetchMock.mockResolvedValue(json(page([])));
      const { getOrganisers } = await load({ host: `${HOST}/` });

      await getOrganisers();

      expect(calledUrls()).toEqual([`${HOST}/api/v1/organizers`]);
    });

    it('ignores multiple trailing slashes', async () => {
      fetchMock.mockResolvedValue(json(page([])));
      const { getOrganisers } = await load({ host: `${HOST}///` });

      await getOrganisers();

      expect(calledUrls()).toEqual([`${HOST}/api/v1/organizers`]);
    });

    it('still accepts same-origin `next` links when the host has a trailing slash', async () => {
      const p2 = `${HOST}/api/v1/organizers/?page=2`;
      useRoutes({
        [`${HOST}/api/v1/organizers`]: page([{ slug: 'a' }], p2),
        [p2]: page([{ slug: 'b' }])
      });
      const { getOrganisers } = await load({ host: `${HOST}/` });

      const result = await getOrganisers();

      expect(result.map((o) => o.slug)).toEqual(['a', 'b']);
    });
  });
});
