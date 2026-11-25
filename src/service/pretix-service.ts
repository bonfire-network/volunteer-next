/**
 * Service for interacting with the Pretix API
 * @since 2026-11-22
 * @author Michael Townsend <@continuities>
 */

const { PRETIX_API_KEY, PRETIX_HOST } = process.env;

const stripSlashes = (host: string) => host.replace(/\/+$/, '');

const doFetch = async <T>(uri: string): Promise<Paginated<T>> => {
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

const getFromPretix = async <T>(endpoint: string): Promise<T[]> => {
  if (!PRETIX_API_KEY) {
    throw new Error('PRETIX_API_KEY missing in environment');
  }
  if (!PRETIX_HOST) {
    throw new Error('PRETIX_HOST missing in environment');
  }

  const results = [];
  for (let uri: string | null = `${stripSlashes(PRETIX_HOST)}/api/v1/${endpoint}`; uri; ) {
    const result: Paginated<T> = await doFetch<T>(uri);
    results.push(...result.results);
    uri = result.next;
    if (uri && new URL(uri).origin !== stripSlashes(PRETIX_HOST)) {
      throw new Error('Pretix pagination is redirecting outside of PRETIX_HOST');
    }
  }

  return results;
};

const withOrganiser =
  <T>(endpoint: string) =>
  async (organiser?: string): Promise<T[]> => {
    if (organiser) {
      return await getFromPretix(`organizers/${encodeURIComponent(organiser)}/${endpoint}`);
    }
    const organisers = await getOrganisers();
    return (
      await Promise.all(
        organisers.map<Promise<T[]>>(
          async ({ slug }) =>
            await getFromPretix(`organizers/${encodeURIComponent(slug)}/${endpoint}`)
        )
      )
    ).flat();
  };

/**
 * Fetches a list of all Organisers from Pretix
 * @returns An array of PretixOrganisers
 */
export const getOrganisers = async (): Promise<PretixOrganiser[]> =>
  await getFromPretix('organizers');

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
  getFromPretix(
    `organizers/${encodeURIComponent(organiser)}/events/${encodeURIComponent(event)}/orderpositions`
  );

/**
 * Fetches a list of all Orders from Pretix
 * @param organiser - Organiser slug to fetch orders for
 * @param event - Event slug to fetch orders for
 * @returns An array of PretixOrders
 */
export const getOrders = async (organiser: string, event: string): Promise<PretixOrder[]> =>
  getFromPretix(
    `organizers/${encodeURIComponent(organiser)}/events/${encodeURIComponent(event)}/orders`
  );

export const getItems = async (organiser: string, event: string): Promise<PretixItem[]> =>
  getFromPretix(
    `organizers/${encodeURIComponent(organiser)}/events/${encodeURIComponent(event)}/items`
  );
/**
 * Generates a TicketingContext using the Pretix API
 * @returns A TicketingContext loaded from the Pretix API
 */
export const getTicketingContext = async (): Promise<TicketingContext> => {
  const context: TicketingContext = {
    provider: 'pretix',
    organisers: {}
  };

  const organisersData = await getOrganisers();
  for (const organiser of organisersData) {
    const organiserContext: TicketingOrganiserContext = {
      name: organiser.name,
      events: {}
    };
    const eventsData = await getEvents(organiser.slug);
    for (const event of eventsData) {
      const itemsData = await getItems(organiser.slug, event.slug);
      const eventContext: TicketingEventContext = {
        name: event.name,
        items: Object.fromEntries(itemsData.map((item) => [item.id, item.name]))
      };
      organiserContext.events[event.slug] = eventContext;
    }
    context.organisers[organiser.slug] = organiserContext;
  }

  return context;
};
