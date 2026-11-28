import { inTransaction } from '@/db';
import { getOrders, getOrganiser, getOrganisers } from '@/service/pretix-service';
import { addTickets, removeTickets, saveTicketSyncHistory } from '@/service/ticketing-service';
import { syncTickets } from './ticketing';

// --- Mocks -----------------------------------------------------------------

jest.mock('@/db', () => ({ __esModule: true, inTransaction: jest.fn() }));

jest.mock('@/service/pretix-service', () => ({
  getOrders: jest.fn(),
  getOrganiser: jest.fn(),
  getOrganisers: jest.fn()
}));

jest.mock('@/service/ticketing-service', () => ({
  addTickets: jest.fn(),
  removeTickets: jest.fn(),
  saveTicketSyncHistory: jest.fn()
}));

const mockInTransaction = inTransaction as unknown as jest.Mock;
const mockGetOrders = getOrders as unknown as jest.Mock;
const mockGetOrganiser = getOrganiser as unknown as jest.Mock;
const mockGetOrganisers = getOrganisers as unknown as jest.Mock;
const mockAddTickets = addTickets as unknown as jest.Mock;
const mockRemoveTickets = removeTickets as unknown as jest.Mock;
const mockSaveHistory = saveTicketSyncHistory as unknown as jest.Mock;

// --- Environment ---------------------------------------------------------------

const ENV_KEYS = ['TICKETING_PROVIDER', 'PRETIX_ORGANISER'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

/** Sets an environment variable, or removes it. (Assigning undefined would store the string "undefined".) */
const setEnv = (key: (typeof ENV_KEYS)[number], value?: string) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

// --- Fixtures and helpers -------------------------------------------------------

/** Stands in for the PoolClient that inTransaction hands to its callback. */
const client = { name: 'transaction-client' };

const makeTicket = (
  organiser: string,
  event: string,
  id: number,
  orderCode: string = 'ABC12'
): Ticket => ({
  provider: 'pretix',
  organiser,
  event,
  id,
  orderRef: `${organiser}/${event}/${orderCode}`
});

/** One order position per item id. */
const positions = (...items: number[]) =>
  items.map((item, index) => ({ id: index + 1, item, canceled: false }));

const makeOrder = (overrides: Record<string, unknown> = {}) => ({
  code: 'ABC12',
  event: 'festival-2026',
  status: 'p',
  customer: 'cust-1',
  positions: positions(11),
  ...overrides
});

/**
 * Sets up Pretix with the given organisers (keys) and their orders (values).
 * getOrders is called with an organiser slug and returns that organiser's orders.
 */
const setupPretix = (ordersByOrganiser: Record<string, unknown[]>) => {
  const organisers = Object.keys(ordersByOrganiser).map((slug) => ({ slug, name: slug }));
  mockGetOrganisers.mockResolvedValue(organisers);
  mockGetOrganiser.mockImplementation(async (slug: string) =>
    organisers.find((organiser) => organiser.slug === slug)
  );
  mockGetOrders.mockImplementation(async (slug: string) => ordersByOrganiser[slug] ?? []);
};

/** Every ticket that was passed to addTickets, whichever account it was for. */
const savedTickets = (): Ticket[] =>
  Object.values((mockAddTickets.mock.calls[0]?.[0] ?? {}) as Record<string, Ticket[]>).flat();

/** Every ticket that was passed to removeTickets, whichever account it was for. */
const removedTickets = (): Ticket[] =>
  Object.values((mockRemoveTickets.mock.calls[0]?.[0] ?? {}) as Record<string, Ticket[]>).flat();

beforeEach(() => {
  jest.resetAllMocks();
  setEnv('TICKETING_PROVIDER', 'pretix');
  setEnv('PRETIX_ORGANISER', undefined);
  jest.spyOn(console, 'error').mockImplementation(() => {});

  mockInTransaction.mockImplementation(async (callback: (client: unknown) => unknown) =>
    callback(client)
  );
  mockGetOrganisers.mockResolvedValue([]);
  mockGetOrders.mockResolvedValue([]);
  mockAddTickets.mockResolvedValue(undefined);
  mockSaveHistory.mockResolvedValue(undefined);
});

afterAll(() => {
  ENV_KEYS.forEach((key) => setEnv(key, originalEnv[key]));
  jest.restoreAllMocks();
});

// --- syncTickets -------------------------------------------------------------------

describe('syncTickets', () => {
  describe('when the ticketing provider is not pretix', () => {
    it.each([[undefined], [''], ['eventbrite']])(
      'does nothing when TICKETING_PROVIDER is %p',
      async (value) => {
        setEnv('TICKETING_PROVIDER', value);

        await expect(syncTickets()).resolves.toBeUndefined();

        expect(mockGetOrganisers).not.toHaveBeenCalled();
        expect(mockGetOrganiser).not.toHaveBeenCalled();
        expect(mockGetOrders).not.toHaveBeenCalled();
        expect(mockInTransaction).not.toHaveBeenCalled();
        expect(mockAddTickets).not.toHaveBeenCalled();
        expect(mockSaveHistory).not.toHaveBeenCalled();
      }
    );
  });

  describe('which organisers are synced', () => {
    it('syncs every organiser when PRETIX_ORGANISER is not set', async () => {
      setupPretix({ 'org-a': [], 'org-b': [] });

      await syncTickets();

      expect(mockGetOrganisers).toHaveBeenCalledTimes(1);
      expect(mockGetOrganiser).not.toHaveBeenCalled();
      expect(mockGetOrders).toHaveBeenCalledTimes(2);
      expect(mockGetOrders).toHaveBeenCalledWith('org-a');
      expect(mockGetOrders).toHaveBeenCalledWith('org-b');
    });

    it('syncs only the configured organiser when PRETIX_ORGANISER is set', async () => {
      setEnv('PRETIX_ORGANISER', 'org-b');
      setupPretix({ 'org-a': [makeOrder()], 'org-b': [] });

      await syncTickets();

      expect(mockGetOrganiser).toHaveBeenCalledTimes(1);
      expect(mockGetOrganiser).toHaveBeenCalledWith('org-b');
      expect(mockGetOrganisers).not.toHaveBeenCalled();
      expect(mockGetOrders).toHaveBeenCalledTimes(1);
      expect(mockGetOrders).toHaveBeenCalledWith('org-b');
    });

    it('syncs every organiser when PRETIX_ORGANISER is an empty string', async () => {
      setEnv('PRETIX_ORGANISER', '');
      setupPretix({ 'org-a': [], 'org-b': [] });

      await syncTickets();

      expect(mockGetOrganisers).toHaveBeenCalledTimes(1);
      expect(mockGetOrganiser).not.toHaveBeenCalled();
    });

    it('fetches the orders of all organisers concurrently', async () => {
      const resolvers: Array<(orders: unknown[]) => void> = [];
      mockGetOrganisers.mockResolvedValue([
        { slug: 'org-a', name: 'A' },
        { slug: 'org-b', name: 'B' }
      ]);
      mockGetOrders.mockImplementation(
        () => new Promise<unknown[]>((resolve) => resolvers.push(resolve))
      );

      const pending = syncTickets();
      // Let the organiser lookup settle. Neither getOrders promise has resolved yet.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockGetOrders).toHaveBeenCalledTimes(2);

      resolvers.forEach((resolve) => resolve([]));
      await pending;
    });
  });

  describe('which orders become tickets', () => {
    it('creates one ticket per position of a paid order, for the order’s customer', async () => {
      setupPretix({
        'org-a': [makeOrder({ customer: 'cust-1', positions: positions(11, 12) })]
      });

      await syncTickets();

      expect(mockAddTickets).toHaveBeenCalledWith(
        {
          'cust-1': [
            makeTicket('org-a', 'festival-2026', 11),
            makeTicket('org-a', 'festival-2026', 12)
          ]
        },
        client
      );
    });

    it('uses the position’s item id as the ticket id and the order’s event as the ticket event', async () => {
      setupPretix({
        'org-a': [makeOrder({ event: 'workshop', positions: positions(21) })]
      });

      await syncTickets();

      expect(savedTickets()).toEqual([makeTicket('org-a', 'workshop', 21)]);
    });

    it.each([['n'], ['e'], ['c']])('ignores orders with status "%s"', async (status) => {
      setupPretix({ 'org-a': [makeOrder({ status })] });

      await syncTickets();

      expect(savedTickets()).toEqual([]);
    });

    it('ignores orders that are not linked to a customer account', async () => {
      setupPretix({
        'org-a': [makeOrder({ customer: null }), makeOrder({ code: 'DEF34', customer: 'cust-2' })]
      });

      await syncTickets();

      expect(mockAddTickets).toHaveBeenCalledWith(
        { 'cust-2': [makeTicket('org-a', 'festival-2026', 11, 'DEF34')] },
        client
      );
    });

    it('combines the tickets of several orders for the same customer, and keeps customers apart', async () => {
      setupPretix({
        'org-a': [
          makeOrder({ code: 'A', customer: 'cust-1', positions: positions(11) }),
          makeOrder({ code: 'B', customer: 'cust-1', event: 'workshop', positions: positions(21) }),
          makeOrder({ code: 'C', customer: 'cust-2', positions: positions(12) })
        ]
      });

      await syncTickets();

      expect(mockAddTickets).toHaveBeenCalledWith(
        {
          'cust-1': [
            makeTicket('org-a', 'festival-2026', 11, 'A'),
            makeTicket('org-a', 'workshop', 21, 'B')
          ],
          'cust-2': [makeTicket('org-a', 'festival-2026', 12, 'C')]
        },
        client
      );
    });

    it('marks each ticket with the organiser its order came from', async () => {
      setupPretix({
        'org-a': [makeOrder({ customer: 'cust-1', positions: positions(11) })],
        'org-b': [makeOrder({ customer: 'cust-2', event: 'meetup', positions: positions(31) })]
      });

      await syncTickets();

      expect(mockAddTickets).toHaveBeenCalledWith(
        {
          'cust-1': [makeTicket('org-a', 'festival-2026', 11)],
          'cust-2': [makeTicket('org-b', 'meetup', 31)]
        },
        client
      );
    });

    it('removes tickets from canceled orders', async () => {
      setupPretix({
        'org-a': [makeOrder({ customer: 'cust-1', status: 'c', positions: positions(11) })]
      });

      await syncTickets();

      expect(mockRemoveTickets).toHaveBeenCalledWith(
        {
          'cust-1': [makeTicket('org-a', 'festival-2026', 11)]
        },
        client
      );
    });

    it('removes tickets before adding new ones', async () => {
      setupPretix({
        'org-a': [
          makeOrder({ customer: 'cust-1', status: 'c', positions: positions(11) }),
          makeOrder({ customer: 'cust-2', status: 'p', positions: positions(11) })
        ]
      });

      await syncTickets();

      expect(mockRemoveTickets).toHaveBeenCalledWith(
        {
          'cust-1': [makeTicket('org-a', 'festival-2026', 11)]
        },
        client
      );

      expect(mockAddTickets).toHaveBeenCalledWith(
        {
          'cust-2': [makeTicket('org-a', 'festival-2026', 11)]
        },
        client
      );

      expect(mockRemoveTickets.mock.invocationCallOrder[0]).toBeLessThan(
        mockAddTickets.mock.invocationCallOrder[0]
      );
    });

    it('creates no tickets for a paid order that has no positions', async () => {
      setupPretix({ 'org-a': [makeOrder({ positions: [] })] });

      await syncTickets();

      expect(savedTickets()).toEqual([]);
    });

    it('still records a successful sync when there is nothing to save', async () => {
      setupPretix({ 'org-a': [] });

      await syncTickets();

      expect(savedTickets()).toEqual([]);
      expect(mockSaveHistory).toHaveBeenCalledWith('pretix', 'success', client);
    });
  });

  describe('saving', () => {
    it('saves the tickets and the sync history in one transaction, with the same client', async () => {
      setupPretix({ 'org-a': [makeOrder()] });

      await syncTickets();

      expect(mockInTransaction).toHaveBeenCalledTimes(1);
      expect(mockAddTickets).toHaveBeenCalledTimes(1);
      expect(mockAddTickets.mock.calls[0][1]).toBe(client);
      expect(mockSaveHistory).toHaveBeenCalledTimes(1);
      expect(mockSaveHistory.mock.calls[0][2]).toBe(client);
    });

    it('records a successful sync for the pretix provider', async () => {
      setupPretix({ 'org-a': [makeOrder()] });

      await syncTickets();

      expect(mockSaveHistory).toHaveBeenCalledWith('pretix', 'success', client);
    });

    it('saves the tickets before recording the success', async () => {
      setupPretix({ 'org-a': [makeOrder()] });

      await syncTickets();

      expect(mockAddTickets.mock.invocationCallOrder[0]).toBeLessThan(
        mockSaveHistory.mock.invocationCallOrder[0]
      );
    });

    it('does not open a transaction until every organiser’s orders have been fetched', async () => {
      let resolveOrgB!: (orders: unknown[]) => void;
      mockGetOrganisers.mockResolvedValue([
        { slug: 'org-a', name: 'A' },
        { slug: 'org-b', name: 'B' }
      ]);
      mockGetOrders.mockImplementation((slug: string) =>
        slug === 'org-a'
          ? Promise.resolve([makeOrder()])
          : new Promise<unknown[]>((resolve) => (resolveOrgB = resolve))
      );

      const pending = syncTickets();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockInTransaction).not.toHaveBeenCalled();

      resolveOrgB([]);
      await pending;

      expect(mockInTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('failures', () => {
    it('logs the error and resolves, rather than throwing, when the organisers cannot be loaded', async () => {
      const error = new Error('pretix is down');
      mockGetOrganisers.mockRejectedValue(error);

      await expect(syncTickets()).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledWith('Failed to sync tickets', error);
      expect(mockInTransaction).not.toHaveBeenCalled();
      expect(mockSaveHistory).not.toHaveBeenCalled();
    });

    it('logs the error and saves nothing when the configured organiser cannot be loaded', async () => {
      setEnv('PRETIX_ORGANISER', 'org-x');
      const error = new Error('organiser not found');
      mockGetOrganiser.mockRejectedValue(error);

      await expect(syncTickets()).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledWith('Failed to sync tickets', error);
      expect(mockInTransaction).not.toHaveBeenCalled();
    });

    it('saves nothing, not even the other organisers’ tickets, when one organiser’s orders cannot be fetched', async () => {
      const error = new Error('no access to org-b');
      mockGetOrganisers.mockResolvedValue([
        { slug: 'org-a', name: 'A' },
        { slug: 'org-b', name: 'B' }
      ]);
      mockGetOrders.mockImplementation(async (slug: string) => {
        if (slug === 'org-b') {
          throw error;
        }
        return [makeOrder()];
      });

      await expect(syncTickets()).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledWith('Failed to sync tickets', error);
      expect(mockInTransaction).not.toHaveBeenCalled();
      expect(mockAddTickets).not.toHaveBeenCalled();
    });

    it('does not record a success when saving the tickets fails', async () => {
      setupPretix({ 'org-a': [makeOrder()] });
      const error = new Error('insert failed');
      mockAddTickets.mockRejectedValue(error);

      await expect(syncTickets()).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledWith('Failed to sync tickets', error);
      expect(mockSaveHistory).not.toHaveBeenCalled();
    });

    it('logs the error and resolves when the transaction itself fails', async () => {
      setupPretix({ 'org-a': [makeOrder()] });
      const error = new Error('could not begin transaction');
      mockInTransaction.mockRejectedValue(error);

      await expect(syncTickets()).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledWith('Failed to sync tickets', error);
    });
  });
});

// --- syncTicketsForUser ------------------------------------------------------------

describe('syncTicketsForUser', () => {
  // Not implemented yet
  it.todo('syncs the tickets of a single user');
});
