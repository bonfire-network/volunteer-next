import type { PoolClient } from 'pg';
import pool from '@/db';
import { ticketFromString } from '@/utils/ticket';
import {
  getTicketRequirementsForEvent,
  addTicketRequirementsToEvent,
  removeTicketRequirementsFromEvent
} from './ticketing-service';

// --- Mocks -----------------------------------------------------------------

jest.mock('@/db', () => ({
  __esModule: true,
  default: { query: jest.fn() }
}));

jest.mock('@/utils/ticket', () => ({ ticketFromString: jest.fn() }));

const mockQuery = pool.query as unknown as jest.Mock;
const mockTicketFromString = ticketFromString as unknown as jest.Mock;

// --- Helpers -----------------------------------------------------------------

const EVENT_ID = '3f2b8a52-9c1e-4d3b-8f7a-1a2b3c4d5e6f';

const normalise = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/** Returns the SQL (whitespace-collapsed) and params of the most recent query call. */
const lastQuery = (query: jest.Mock = mockQuery) => {
  const calls = query.mock.calls;
  const [sql, params] = calls[calls.length - 1];
  return { sql: normalise(sql), params };
};

const makeClient = () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  return { client: { query } as unknown as PoolClient, query };
};

/** Sets TICKETING_PROVIDER, or removes it. (Assigning undefined would store the string "undefined".) */
const setProvider = (value?: string) => {
  if (value === undefined) {
    delete process.env.TICKETING_PROVIDER;
  } else {
    process.env.TICKETING_PROVIDER = value;
  }
};

const originalProvider = process.env.TICKETING_PROVIDER;

beforeEach(() => {
  jest.resetAllMocks();
  setProvider('pretix');
  mockQuery.mockResolvedValue({ rows: [] });
  // Parses "provider:organiser:event:id", the format used by these tests
  mockTicketFromString.mockImplementation((value: string): Ticket => {
    const [provider, organiser, event, id] = value.split(':');
    return { provider, organiser, event, id: Number(id) } as Ticket;
  });
});

afterAll(() => {
  setProvider(originalProvider);
});

// --- getTicketRequirementsForEvent ------------------------------------------

describe('getTicketRequirementsForEvent', () => {
  it.each([[undefined], ['']])(
    'returns an empty array without querying when TICKETING_PROVIDER is %p',
    async (value) => {
      setProvider(value);
      await expect(getTicketRequirementsForEvent(EVENT_ID)).resolves.toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    }
  );

  it('queries the ticket requirements of the given event', async () => {
    await getTicketRequirementsForEvent(EVENT_ID);
    const { sql, params } = lastQuery();
    expect(sql).toContain('FROM ticket_requirement');
    expect(sql).toContain('WHERE "eventId" = $1');
    expect(params).toEqual([EVENT_ID]);
  });

  it('returns an empty array when the event has no ticket requirements', async () => {
    await expect(getTicketRequirementsForEvent(EVENT_ID)).resolves.toEqual([]);
    expect(mockTicketFromString).not.toHaveBeenCalled();
  });

  it('converts each row’s ticket string to a Ticket, in row order', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { eventId: EVENT_ID, ticket: 'pretix:org-a:festival-2026:11' },
        { eventId: EVENT_ID, ticket: 'pretix:org-b:meetup:31' }
      ]
    });

    const tickets = await getTicketRequirementsForEvent(EVENT_ID);

    expect(tickets).toEqual([
      { provider: 'pretix', organiser: 'org-a', event: 'festival-2026', id: 11 },
      { provider: 'pretix', organiser: 'org-b', event: 'meetup', id: 31 }
    ]);
    expect(mockTicketFromString).toHaveBeenCalledTimes(2);
    expect(mockTicketFromString).toHaveBeenCalledWith('pretix:org-a:festival-2026:11');
    expect(mockTicketFromString).toHaveBeenCalledWith('pretix:org-b:meetup:31');
  });

  it('propagates database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection lost'));
    await expect(getTicketRequirementsForEvent(EVENT_ID)).rejects.toThrow('connection lost');
  });

  it('propagates errors from parsing a malformed ticket string', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ eventId: EVENT_ID, ticket: 'garbage' }] });
    mockTicketFromString.mockImplementationOnce(() => {
      throw new Error('Invalid ticket string');
    });
    await expect(getTicketRequirementsForEvent(EVENT_ID)).rejects.toThrow('Invalid ticket string');
  });
});

// --- addTicketRequirementsToEvent --------------------------------------------

describe('addTicketRequirementsToEvent', () => {
  it.each([[undefined], ['']])('does nothing when TICKETING_PROVIDER is %p', async (value) => {
    setProvider(value);
    await addTicketRequirementsToEvent(EVENT_ID, ['t1']);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('does nothing when there are no tickets to add', async () => {
    await addTicketRequirementsToEvent(EVENT_ID, []);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('inserts a single ticket', async () => {
    await addTicketRequirementsToEvent(EVENT_ID, ['t1']);
    const { sql, params } = lastQuery();
    expect(sql).toContain('INSERT INTO "ticket_requirement" ("eventId", "ticket")');
    expect(sql).toContain('VALUES ($1, $2)');
    expect(params).toEqual([EVENT_ID, 't1']);
  });

  it('inserts several tickets in one statement, numbering the placeholders in pairs', async () => {
    await addTicketRequirementsToEvent(EVENT_ID, ['t1', 't2', 't3']);
    const { sql, params } = lastQuery();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(sql).toContain('VALUES ($1, $2), ($3, $4), ($5, $6)');
    expect(params).toEqual([EVENT_ID, 't1', EVENT_ID, 't2', EVENT_ID, 't3']);
  });

  it('ignores tickets that are already required by the event', async () => {
    await addTicketRequirementsToEvent(EVENT_ID, ['t1']);
    expect(lastQuery().sql).toContain('ON CONFLICT ("eventId", "ticket") DO NOTHING');
  });

  it('uses the pool when no client is given', async () => {
    await addTicketRequirementsToEvent(EVENT_ID, ['t1']);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    await addTicketRequirementsToEvent(EVENT_ID, ['t1', 't2'], client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(lastQuery(query).params).toEqual([EVENT_ID, 't1', EVENT_ID, 't2']);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('propagates database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('insert failed'));
    await expect(addTicketRequirementsToEvent(EVENT_ID, ['t1'])).rejects.toThrow('insert failed');
  });
});

// --- removeTicketRequirementsFromEvent ----------------------------------------

describe('removeTicketRequirementsFromEvent', () => {
  it.each([[undefined], ['']])('does nothing when TICKETING_PROVIDER is %p', async (value) => {
    setProvider(value);
    await removeTicketRequirementsFromEvent(EVENT_ID, ['t1']);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('does nothing when there are no tickets to remove', async () => {
    await removeTicketRequirementsFromEvent(EVENT_ID, []);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('deletes the given tickets for the given event only', async () => {
    await removeTicketRequirementsFromEvent(EVENT_ID, ['t1', 't2']);
    const { sql, params } = lastQuery();
    expect(sql).toBe(
      'DELETE FROM ticket_requirement WHERE "eventId" = $1 AND "ticket" = ANY($2::text[])'
    );
    expect(params).toEqual([EVENT_ID, ['t1', 't2']]);
  });

  it('removes any number of tickets with a single query', async () => {
    await removeTicketRequirementsFromEvent(EVENT_ID, ['t1', 't2', 't3', 't4']);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    await removeTicketRequirementsFromEvent(EVENT_ID, ['t1'], client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('propagates database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('delete failed'));
    await expect(removeTicketRequirementsFromEvent(EVENT_ID, ['t1'])).rejects.toThrow(
      'delete failed'
    );
  });
});
