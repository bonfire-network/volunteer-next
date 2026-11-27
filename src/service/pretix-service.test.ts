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

describe('getOrganiser', () => {
  const url = `${HOST}/api/v1/organizers/acme`;
  const acme = { name: 'Acme', slug: 'acme', public_url: `${HOST}/acme/`, plugins: [] };

  it('fetches the single organiser from /api/v1/organizers/{slug}', async () => {
    useRoutes({ [url]: acme });
    const { getOrganiser } = await load();

    await expect(getOrganiser('acme')).resolves.toEqual(acme);
    expect(calledUrls()).toEqual([url]);
  });

  it('does not request the organiser list', async () => {
    useRoutes({ [url]: acme });
    const { getOrganiser } = await load();

    await getOrganiser('acme');

    expect(calledUrls()).not.toContain(`${HOST}/api/v1/organizers`);
  });

  it('sends the token and JSON accept headers', async () => {
    useRoutes({ [url]: acme });
    const { getOrganiser } = await load();

    await getOrganiser('acme');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({
      Authorization: `Token ${API_KEY}`,
      Accept: 'application/json'
    });
  });

  it('URL-encodes the organiser slug', async () => {
    useRoutes({ [`${HOST}/api/v1/organizers/acme%20corp%2F..%2Fadmin`]: acme });
    const { getOrganiser } = await load();

    await expect(getOrganiser('acme corp/../admin')).resolves.toEqual(acme);
  });

  it('does not produce a double slash when the host has trailing slashes', async () => {
    useRoutes({ [url]: acme });
    const { getOrganiser } = await load({ host: `${HOST}///` });

    await getOrganiser('acme');

    expect(calledUrls()).toEqual([url]);
  });

  it('throws when PRETIX_API_KEY is missing, without calling fetch', async () => {
    const { getOrganiser } = await load({ apiKey: undefined });

    await expect(getOrganiser('acme')).rejects.toThrow('PRETIX_API_KEY missing in environment');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when PRETIX_HOST is missing, without calling fetch', async () => {
    const { getOrganiser } = await load({ host: undefined });

    await expect(getOrganiser('acme')).rejects.toThrow('PRETIX_HOST missing in environment');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws with the URI and status text on a non-2xx response', async () => {
    useRoutes({ [url]: () => failure(404, 'Not Found') });
    const { getOrganiser } = await load();

    await expect(getOrganiser('acme')).rejects.toThrow(
      `Pretix call to ${url} failed: 404 Not Found`
    );
  });

  it('propagates network errors from fetch', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const { getOrganiser } = await load();

    await expect(getOrganiser('acme')).rejects.toThrow('fetch failed');
  });

  it('rejects when the body is not valid JSON', async () => {
    fetchMock.mockResolvedValue(invalidJson());
    const { getOrganiser } = await load();

    await expect(getOrganiser('acme')).rejects.toThrow();
  });
});

describe('getItems', () => {
  const url = `${HOST}/api/v1/organizers/acme/events/fest/items`;
  const items = [
    { id: 11, name: { en: 'Volunteer ticket' } },
    { id: 12, name: { en: 'Day pass' } }
  ];

  it('requests the event’s items endpoint', async () => {
    useRoutes({ [url]: page(items) });
    const { getItems } = await load();

    await expect(getItems('acme', 'fest')).resolves.toEqual(items);
    expect(calledUrls()).toEqual([url]);
  });

  it('returns an empty array when the event has no items', async () => {
    useRoutes({ [url]: page([]) });
    const { getItems } = await load();

    await expect(getItems('acme', 'fest')).resolves.toEqual([]);
  });

  it('follows pagination and concatenates pages in order', async () => {
    const p2 = `${url}/?page=2`;
    useRoutes({
      [url]: page([items[0]], p2),
      [p2]: page([items[1]])
    });
    const { getItems } = await load();

    const result = await getItems('acme', 'fest');

    expect(result.map((i) => i.id)).toEqual([11, 12]);
    expect(calledUrls()).toEqual([url, p2]);
  });

  it('URL-encodes organiser and event slugs', async () => {
    useRoutes({ [`${HOST}/api/v1/organizers/o%2F1/events/e%201/items`]: page(items) });
    const { getItems } = await load();

    await expect(getItems('o/1', 'e 1')).resolves.toEqual(items);
  });

  it('does not fan out across organisers or events', async () => {
    useRoutes({ [url]: page(items) });
    const { getItems } = await load();

    await getItems('acme', 'fest');

    expect(calledUrls()).toEqual([url]);
  });

  it('refuses to follow a `next` URL on a different origin, so the token is not sent there', async () => {
    useRoutes({ [url]: page([items[0]], 'https://evil.example.com/steal-the-token') });
    const { getItems } = await load();

    await expect(getItems('acme', 'fest')).rejects.toThrow(/redirecting outside/i);
    expect(calledUrls()).toEqual([url]);
  });

  it('throws when PRETIX_API_KEY is missing, without calling fetch', async () => {
    const { getItems } = await load({ apiKey: undefined });

    await expect(getItems('acme', 'fest')).rejects.toThrow('PRETIX_API_KEY missing in environment');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws with the URI and status text on a non-2xx response', async () => {
    useRoutes({ [url]: () => failure(403, 'Forbidden') });
    const { getItems } = await load();

    await expect(getItems('acme', 'fest')).rejects.toThrow(
      `Pretix call to ${url} failed: 403 Forbidden`
    );
  });
});

describe('getTicketingContext', () => {
  const organisersUrl = `${HOST}/api/v1/organizers`;
  const organiserUrl = (organiser: string) => `${organisersUrl}/${organiser}`;
  const eventsUrl = (organiser: string) => `${organiserUrl(organiser)}/events`;
  const itemsUrl = (organiser: string, event: string) => `${eventsUrl(organiser)}/${event}/items`;

  type Routes = Parameters<typeof useRoutes>[0];
  type OrganiserFixture = { slug: string; name: string };
  type EventFixture = { slug: string; name: MultilingualString };
  type ItemFixture = { id: number; name: MultilingualString };

  const orgA: OrganiserFixture = { slug: 'org-a', name: 'Org A' };
  const orgB: OrganiserFixture = { slug: 'org-b', name: 'Org B' };

  const festival: EventFixture = {
    slug: 'festival-2026',
    name: { en: 'Festival 2026', fr: 'Festival 2026 (FR)' }
  };
  const workshop: EventFixture = { slug: 'workshop', name: { en: 'Workshop' } };
  const meetup: EventFixture = { slug: 'meetup', name: { en: 'Meetup' } };

  const volunteer: ItemFixture = {
    id: 11,
    name: { en: 'Volunteer ticket', fr: 'Billet bénévole' }
  };
  const dayPass: ItemFixture = { id: 12, name: { en: 'Day pass' } };
  const workshopTicket: ItemFixture = { id: 21, name: { en: 'Workshop ticket' } };

  /**
   * Routes for a whole Pretix setup. `events` maps an organiser slug to its events and
   * `items` maps "organiser/event" to that event's items. `overrides` replaces
   * individual routes, e.g. to make one of them fail or paginate.
   *
   * getOrganisers, getOrganiser, getEvents and getItems live in the same module as
   * getTicketingContext, so they can't be mocked reliably from outside. Mocking the HTTP
   * layer instead means they run for real, but all the assertions here are about what
   * getTicketingContext asks for and how it assembles the answers.
   */
  const useTicketingRoutes = (
    config: {
      organisers: OrganiserFixture[];
      events?: Record<string, EventFixture[]>;
      items?: Record<string, ItemFixture[]>;
    },
    overrides: Routes = {}
  ) => {
    const { organisers, events = {}, items = {} } = config;
    const routes: Routes = { [organisersUrl]: page(organisers) };
    for (const organiser of organisers) {
      const organiserEvents = events[organiser.slug] ?? [];
      routes[organiserUrl(organiser.slug)] = organiser;
      routes[eventsUrl(organiser.slug)] = page(organiserEvents);
      for (const event of organiserEvents) {
        routes[itemsUrl(organiser.slug, event.slug)] = page(
          items[`${organiser.slug}/${event.slug}`] ?? []
        );
      }
    }
    useRoutes({ ...routes, ...overrides });
  };

  beforeEach(() => {
    setEnv('PRETIX_ORGANISER', undefined);
  });

  it('identifies the provider as pretix', async () => {
    useTicketingRoutes({ organisers: [] });
    const { getTicketingContext } = await load();

    const context = await getTicketingContext();

    expect(context!.provider).toBe('pretix');
  });

  it('builds the organiser → event → item structure', async () => {
    useTicketingRoutes({
      organisers: [orgA, orgB],
      events: { 'org-a': [festival, workshop], 'org-b': [meetup] },
      items: {
        'org-a/festival-2026': [volunteer, dayPass],
        'org-a/workshop': [workshopTicket]
      }
    });
    const { getTicketingContext } = await load();

    const context = await getTicketingContext();

    expect(context).toEqual({
      provider: 'pretix',
      organisers: {
        'org-a': {
          name: 'Org A',
          events: {
            'festival-2026': {
              name: { en: 'Festival 2026', fr: 'Festival 2026 (FR)' },
              items: {
                11: { en: 'Volunteer ticket', fr: 'Billet bénévole' },
                12: { en: 'Day pass' }
              }
            },
            workshop: {
              name: { en: 'Workshop' },
              items: { 21: { en: 'Workshop ticket' } }
            }
          }
        },
        'org-b': {
          name: 'Org B',
          events: { meetup: { name: { en: 'Meetup' }, items: {} } }
        }
      }
    });
  });

  it('keys items by their numeric id and keeps their multilingual names', async () => {
    useTicketingRoutes({
      organisers: [orgA],
      events: { 'org-a': [festival] },
      items: { 'org-a/festival-2026': [volunteer, dayPass] }
    });
    const { getTicketingContext } = await load();

    const context = await getTicketingContext();

    const contextItems = context!.organisers['org-a'].events['festival-2026'].items;
    expect(Object.keys(contextItems)).toEqual(['11', '12']);
    expect(contextItems[11]).toEqual({ en: 'Volunteer ticket', fr: 'Billet bénévole' });
  });

  it('keeps organisers in the order Pretix returned them', async () => {
    useTicketingRoutes({ organisers: [orgB, orgA] });
    const { getTicketingContext } = await load();

    const context = await getTicketingContext();

    expect(Object.keys(context!.organisers)).toEqual(['org-b', 'org-a']);
  });

  describe('which organisers are loaded', () => {
    it('loads every organiser when PRETIX_ORGANISER is not set', async () => {
      useTicketingRoutes({ organisers: [orgA, orgB] });
      const { getTicketingContext } = await load();

      const context = await getTicketingContext();

      expect(Object.keys(context!.organisers)).toEqual(['org-a', 'org-b']);
      expect(calledUrls()).toContain(organisersUrl);
      expect(calledUrls()).not.toContain(organiserUrl('org-a'));
      expect(calledUrls()).not.toContain(organiserUrl('org-b'));
    });

    it('loads only the configured organiser when PRETIX_ORGANISER is set', async () => {
      setEnv('PRETIX_ORGANISER', 'org-b');
      useTicketingRoutes({
        organisers: [orgA, orgB],
        events: { 'org-a': [festival], 'org-b': [meetup] }
      });
      const { getTicketingContext } = await load();

      const context = await getTicketingContext();

      expect(Object.keys(context!.organisers)).toEqual(['org-b']);
      expect(context!.organisers['org-b'].name).toBe('Org B');
      expect(calledUrls()).toContain(organiserUrl('org-b'));
      expect(calledUrls()).toContain(eventsUrl('org-b'));
      expect(calledUrls()).not.toContain(organisersUrl);
      expect(calledUrls()).not.toContain(eventsUrl('org-a'));
    });

    it('loads every organiser when PRETIX_ORGANISER is an empty string', async () => {
      setEnv('PRETIX_ORGANISER', '');
      useTicketingRoutes({ organisers: [orgA, orgB] });
      const { getTicketingContext } = await load();

      const context = await getTicketingContext();

      expect(Object.keys(context!.organisers)).toEqual(['org-a', 'org-b']);
      expect(calledUrls()).toContain(organisersUrl);
    });
  });

  describe('which requests are made', () => {
    it('fetches events once per organiser and items once per event, and nothing else', async () => {
      useTicketingRoutes({
        organisers: [orgA, orgB],
        events: { 'org-a': [festival, workshop], 'org-b': [meetup] }
      });
      const { getTicketingContext } = await load();

      await getTicketingContext();

      // Sorted, so the test doesn't depend on whether the requests run in sequence or in parallel
      expect([...calledUrls()].sort()).toEqual(
        [
          organisersUrl,
          eventsUrl('org-a'),
          eventsUrl('org-b'),
          itemsUrl('org-a', 'festival-2026'),
          itemsUrl('org-a', 'workshop'),
          itemsUrl('org-b', 'meetup')
        ].sort()
      );
    });

    it('follows pagination when listing events', async () => {
      const p2 = `${eventsUrl('org-a')}/?page=2`;
      useTicketingRoutes(
        {
          organisers: [orgA],
          events: { 'org-a': [festival, workshop] },
          items: { 'org-a/workshop': [workshopTicket] }
        },
        {
          [eventsUrl('org-a')]: page([festival], p2),
          [p2]: page([workshop])
        }
      );
      const { getTicketingContext } = await load();

      const context = await getTicketingContext();

      expect(Object.keys(context!.organisers['org-a'].events)).toEqual([
        'festival-2026',
        'workshop'
      ]);
      expect(context!.organisers['org-a'].events.workshop.items).toEqual({
        21: { en: 'Workshop ticket' }
      });
    });

    it('follows pagination when listing items', async () => {
      const p2 = `${itemsUrl('org-a', 'festival-2026')}/?page=2`;
      useTicketingRoutes(
        { organisers: [orgA], events: { 'org-a': [festival] } },
        {
          [itemsUrl('org-a', 'festival-2026')]: page([volunteer], p2),
          [p2]: page([dayPass])
        }
      );
      const { getTicketingContext } = await load();

      const context = await getTicketingContext();

      expect(Object.keys(context!.organisers['org-a'].events['festival-2026'].items)).toEqual([
        '11',
        '12'
      ]);
    });
  });

  describe('edge cases', () => {
    it('returns no organisers, and makes no further requests, when there are none', async () => {
      useTicketingRoutes({ organisers: [] });
      const { getTicketingContext } = await load();

      const context = await getTicketingContext();

      expect(context).toEqual({ provider: 'pretix', organisers: {} });
      expect(calledUrls()).toEqual([organisersUrl]);
    });

    it('keeps organisers that have no events', async () => {
      useTicketingRoutes({ organisers: [orgA] });
      const { getTicketingContext } = await load();

      const context = await getTicketingContext();

      expect(context!.organisers['org-a']).toEqual({ name: 'Org A', events: {} });
    });

    it('keeps events that have no items', async () => {
      useTicketingRoutes({ organisers: [orgA], events: { 'org-a': [festival] } });
      const { getTicketingContext } = await load();

      const context = await getTicketingContext();

      expect(context!.organisers['org-a'].events['festival-2026'].items).toEqual({});
    });

    it('keeps events with the same slug under different organisers apart', async () => {
      useTicketingRoutes({
        organisers: [orgA, orgB],
        events: {
          'org-a': [{ slug: 'festival-2026', name: { en: 'Org A festival' } }],
          'org-b': [{ slug: 'festival-2026', name: { en: 'Org B festival' } }]
        },
        items: {
          'org-a/festival-2026': [{ id: 11, name: { en: 'A ticket' } }],
          'org-b/festival-2026': [{ id: 31, name: { en: 'B ticket' } }]
        }
      });
      const { getTicketingContext } = await load();

      const context = await getTicketingContext();

      expect(context!.organisers['org-a'].events['festival-2026']).toEqual({
        name: { en: 'Org A festival' },
        items: { 11: { en: 'A ticket' } }
      });
      expect(context!.organisers['org-b'].events['festival-2026']).toEqual({
        name: { en: 'Org B festival' },
        items: { 31: { en: 'B ticket' } }
      });
    });

    // Expected behaviour, which getTicketingContext doesn't have yet: it lists every item,
    // including inactive ones and ones that aren't tickets (merchandise, add-ons).
    it.todo('leaves out inactive items and items that do not grant admission');
  });

  describe('errors', () => {
    it('throws when PRETIX_API_KEY is missing, without calling fetch', async () => {
      useTicketingRoutes({ organisers: [orgA] });
      const { getTicketingContext } = await load({ apiKey: undefined });

      await expect(getTicketingContext()).rejects.toThrow('PRETIX_API_KEY missing in environment');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when PRETIX_HOST is missing, without calling fetch', async () => {
      useTicketingRoutes({ organisers: [orgA] });
      const { getTicketingContext } = await load({ host: undefined });

      await expect(getTicketingContext()).rejects.toThrow('PRETIX_HOST missing in environment');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when the organiser list cannot be loaded, without fetching events', async () => {
      useTicketingRoutes(
        { organisers: [orgA] },
        { [organisersUrl]: () => failure(500, 'Internal Server Error') }
      );
      const { getTicketingContext } = await load();

      await expect(getTicketingContext()).rejects.toThrow(/organizers failed: 500/);
      expect(calledUrls()).toEqual([organisersUrl]);
    });

    it('rejects when the configured organiser cannot be loaded', async () => {
      setEnv('PRETIX_ORGANISER', 'org-x');
      useTicketingRoutes(
        { organisers: [orgA] },
        { [organiserUrl('org-x')]: () => failure(404, 'Not Found') }
      );
      const { getTicketingContext } = await load();

      await expect(getTicketingContext()).rejects.toThrow(
        `Pretix call to ${organiserUrl('org-x')} failed: 404 Not Found`
      );
    });

    it('returns undefined when the events of any organiser cannot be loaded', async () => {
      useTicketingRoutes(
        { organisers: [orgA, orgB], events: { 'org-a': [festival] } },
        { [eventsUrl('org-b')]: () => failure(500, 'Internal Server Error') }
      );
      const { getTicketingContext } = await load();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(await getTicketingContext()).toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('returns undefined when the items of any event cannot be loaded', async () => {
      useTicketingRoutes(
        { organisers: [orgA], events: { 'org-a': [festival, workshop] } },
        { [itemsUrl('org-a', 'workshop')]: () => failure(403, 'Forbidden') }
      );
      const { getTicketingContext } = await load();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(await getTicketingContext()).toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
