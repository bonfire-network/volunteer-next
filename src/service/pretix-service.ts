/**
 * Service for interacting with the Pretix API
 * @since 2026-11-22
 * @author Michael Townsend <@continuities>
 */

const { PRETIX_API_KEY, PRETIX_HOST } = process.env;

const getFromPretix = async (endpoint: string) => {
  if (!PRETIX_API_KEY) {
    throw new Error('PRETIX_API_KEY missing in environment');
  }
  if (!PRETIX_HOST) {
    throw new Error('PRETIX_HOST missing in environment');
  }
  const result = await fetch(`${PRETIX_HOST}/api/v1/${endpoint}`, {
    headers: {
      Authorization: `Token ${PRETIX_API_KEY}`,
      Accept: 'application/json'
    }
  });
  if (!result.ok) {
    throw new Error(`Pretix ${endpoint} call failed: ${result.statusText}`);
  }

  // TODO: Support pagination

  return (await result.json()).results;
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

export const getOrganisers = async (): Promise<PretixOrganiser[]> =>
  await getFromPretix('organizers');
export const getEvents = withOrganiser<PretixEvent>('events');
export const getCustomers = withOrganiser<PretixCustomer>('customers');
export const getOrderPositions = async (
  organiser: string,
  event: string
): Promise<PretixOrderPosition[]> =>
  getFromPretix(`organizers/${organiser}/events/${event}/orderpositions`);
export const getOrders = async (organiser: string, event: string): Promise<PretixOrder[]> =>
  getFromPretix(`organizers/${organiser}/events/${event}/orders`);
