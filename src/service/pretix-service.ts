/**
 * Service for interacting with the Pretix API
 * @since 2026-11-22
 * @author Michael Townsend <@continuities>
 */

const { PRETIX_API_KEY, PRETIX_HOST, PRETIX_ORGANISER } = process.env;

const stripSlashes = (host: string) => host.replace(/\/+$/, '');

const doFetch = async <T>(uri: string | URL): Promise<T> => {
  const result = await fetch(uri, {
    headers: {
      Authorization: `Token ${PRETIX_API_KEY}`,
      Accept: 'application/json'
    }
  });
  if (!result.ok) {
    throw new Error(`Pretix call to ${uri} failed: ${result.status} ${result.statusText}`);
  }

  return result.json();
};

const getListFromPretix = async <T>(
  endpoint: string,
  params: Record<string, string> = {}
): Promise<T[]> => {
  if (!PRETIX_API_KEY) {
    throw new Error('PRETIX_API_KEY missing in environment');
  }
  if (!PRETIX_HOST) {
    throw new Error('PRETIX_HOST missing in environment');
  }

  const results: T[] = [];
  const url = new URL(`${stripSlashes(PRETIX_HOST)}/api/v1/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  for (let uri: string | URL | null = url; uri; ) {
    const result: Paginated<T> = await doFetch<Paginated<T>>(uri);
    results.push(...result.results);
    uri = result.next;
    if (uri && new URL(uri).origin !== stripSlashes(PRETIX_HOST)) {
      throw new Error('Pretix pagination is redirecting outside of PRETIX_HOST');
    }
  }

  return results;
};

const getFromPretix = async <T>(endpoint: string): Promise<T> => {
  if (!PRETIX_API_KEY) {
    throw new Error('PRETIX_API_KEY missing in environment');
  }
  if (!PRETIX_HOST) {
    throw new Error('PRETIX_HOST missing in environment');
  }
  const uri = `${stripSlashes(PRETIX_HOST)}/api/v1/${endpoint}`;
  return doFetch<T>(uri);
};

const withOrganiser =
  <T>(endpoint: string) =>
  async (organiser?: string): Promise<T[]> => {
    if (organiser) {
      return await getListFromPretix(`organizers/${encodeURIComponent(organiser)}/${endpoint}`);
    }
    const organisers = await getOrganisers();
    return (
      await Promise.all(
        organisers.map<Promise<T[]>>(
          async ({ slug }) =>
            await getListFromPretix(`organizers/${encodeURIComponent(slug)}/${endpoint}`)
        )
      )
    ).flat();
  };

/**
 * Fetches a single organiser from Pretix
 * @param organiser - Organiser slug to fetch data for
 * @returns A PretixOrganiser
 */
export const getOrganiser = async (organiser: TicketOrganiser): Promise<PretixOrganiser> =>
  await getFromPretix(`organizers/${encodeURIComponent(organiser)}`);

/**
 * Fetches a list of all Organisers from Pretix
 * @returns An array of PretixOrganisers
 */
export const getOrganisers = async (): Promise<PretixOrganiser[]> =>
  await getListFromPretix('organizers');

/**
 * Fetches a list of all Events from Pretix
 * @param organiser? - Optional Organiser slug to fetch events for. If omitted, fetches for all organisers
 * @returns An array of PretixEvents
 */
export const getEvents = withOrganiser<PretixEvent>('events');

/**
 * Fetches a list of all Customers from Pretix
 * @param organiser? - Optional Organiser slug to fetch customers for. If omitted, fetches for all organisers
 * @returns An array of PretixCustomers
 */
export const getCustomers = withOrganiser<PretixCustomer>('customers');

/**
 * Fetches a list of all OrderPositions from Pretix
 * @param organiser - Organiser slug to fetch order positions for
 * @param event - Event slug to fetch order positions for
 * @returns An array of PretixOrderPositions
 */
export const getOrderPositions = async (
  organiser: string,
  event: string
): Promise<PretixOrderPosition[]> =>
  getListFromPretix(
    `organizers/${encodeURIComponent(organiser)}/events/${encodeURIComponent(event)}/orderpositions`
  );

/**
 * Fetches a list of all Orders from Pretix
 * @param organiser - Organiser slug to fetch orders for
 * @param event - Optional event slug to fetch orders for. Otherwise fetches across all events
 * @returns An array of PretixOrders
 */
export const getOrders = async (organiser: string, event?: string): Promise<PretixOrder[]> => {
  const eventComponent = event ? `/events/${encodeURIComponent(event)}` : '';
  return getListFromPretix(`organizers/${encodeURIComponent(organiser)}${eventComponent}/orders`, {
    include_canceled_positions: 'true'
  });
};

/**
 * Fetches a list of all Items from Pretix
 * @param organiser - Organiser slug to fetch orders for
 * @param event - Event slug to fetch orders for
 * @returns An array of PretixItems
 */
export const getItems = async (organiser: string, event: string): Promise<PretixItem[]> =>
  getListFromPretix(
    `organizers/${encodeURIComponent(organiser)}/events/${encodeURIComponent(event)}/items`
  );
/**
 * Generates a TicketingContext using the Pretix API
 * @returns A TicketingContext loaded from the Pretix API
 */
export const getTicketingContext = async (): Promise<TicketingContext | undefined> => {
  const organisersData = PRETIX_ORGANISER
    ? [await getOrganiser(PRETIX_ORGANISER)]
    : await getOrganisers();

  try {
    return {
      provider: 'pretix',
      organisers: Object.fromEntries(
        await Promise.all(
          organisersData.map<Promise<[TicketOrganiser, TicketingOrganiserContext]>>(async (o) => [
            o.slug,
            {
              name: o.name,
              events: Object.fromEntries(
                await Promise.all(
                  (await getEvents(o.slug)).map<Promise<[TicketEvent, TicketingEventContext]>>(
                    async (e) => [
                      e.slug,
                      {
                        name: e.name,
                        items: Object.fromEntries(
                          (await getItems(o.slug, e.slug)).map<[TicketId, MultilingualString]>(
                            (item) => [Number(item.id), item.name]
                          )
                        )
                      }
                    ]
                  )
                )
              )
            }
          ])
        )
      )
    };
  } catch (e) {
    console.error('Fetching Pretix context failed', e);
    return undefined;
  }
};
