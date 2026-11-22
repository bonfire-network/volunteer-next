/**
 * Service for interacting with the Pretix API
 * @since 2026-11-22
 * @author Michael Townsend <@continuities>
 */

const { PRETIX_API_KEY, PRETIX_HOST } = process.env;

const doFetch = async (uri: string) => {
  const result = await fetch(uri, {
    headers: {
      Authorization: `Token ${PRETIX_API_KEY}`,
      Accept: 'application/json'
    }
  });
  if (!result.ok) {
    throw new Error(`Pretix call to ${uri} failed: ${result.statusText}`);
  }

  return result.json();
};

const getFromPretix = async (endpoint: string) => {
  if (!PRETIX_API_KEY) {
    throw new Error('PRETIX_API_KEY missing in environment');
  }
  if (!PRETIX_HOST) {
    throw new Error('PRETIX_HOST missing in environment');
  }

  const results = [];
  for (let uri = `${PRETIX_HOST}/api/v1/${endpoint}`; uri; ) {
    const result = await doFetch(uri);
    results.push(...result.results);
    uri = result.next;
  }

  return results;
};

const withOrganiser =
  <T>(endpoint: string) =>
  async (organiser?: string): Promise<T[]> => {
    if (organiser) {
      return await getFromPretix(`organizers/${organiser}/${endpoint}`);
    }
    console.debug(`[Pretix] No organiser provided. Fetching all...`);
    const organisers = await getOrganisers();
    console.debug(`[Pretix] got organisers ${JSON.stringify(organisers, null, 2)}`);
    return (
      await Promise.all(
        organisers.map<Promise<T[]>>(
          async ({ slug }) => await getFromPretix(`organizers/${slug}/${endpoint}`)
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
  getFromPretix(`organizers/${organiser}/events/${event}/orderpositions`);

/**
 * Fetches a list of all Orders from Pretix
 * @param organiser - Organiser slug to fetch orders for
 * @param event - Event slug to fetch orders for
 * @returns An array of PretixOrders
 */
export const getOrders = async (organiser: string, event: string): Promise<PretixOrder[]> =>
  getFromPretix(`organizers/${organiser}/events/${event}/orders`);
