import type { PoolClient } from 'pg';
import pool from '@/db';
import { ticketFromString, ticketToString } from '@/utils/ticket';
import {
  getTicketRequirementsForEvent,
  addTicketRequirementsToEvent,
  removeTicketRequirementsFromEvent,
  addTickets,
  saveTicketSyncHistory,
  getTicketsForUser,
  removeTickets
} from './ticketing-service';

// --- Mocks -----------------------------------------------------------------

jest.mock('@/db', () => ({
  __esModule: true,
  default: { query: jest.fn() }
}));

jest.mock('@/utils/ticket', () => ({ ticketFromString: jest.fn(), ticketToString: jest.fn() }));

const mockQuery = pool.query as unknown as jest.Mock;
const mockTicketFromString = ticketFromString as unknown as jest.Mock;
const mockTicketToString = ticketToString as unknown as jest.Mock;

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
  // The inverse of the parser above
  mockTicketToString.mockImplementation(
    (ticket: Ticket): string =>
      `${ticket.provider}:${ticket.organiser}:${ticket.event}:${ticket.id}`
  );
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

// --- addTickets ------------------------------------------------------------------

const makeTicket = (organiser: string, event: string, id: number): Ticket => ({
  provider: 'pretix',
  organiser,
  event,
  id
});

const volunteer = makeTicket('org-a', 'festival-2026', 11);
const dayPass = makeTicket('org-a', 'festival-2026', 12);
const meetup = makeTicket('org-b', 'meetup', 31);

// What ticketToString returns for the tickets above, in the format the mock uses
const VOLUNTEER = 'pretix:org-a:festival-2026:11';
const DAY_PASS = 'pretix:org-a:festival-2026:12';
const MEETUP = 'pretix:org-b:meetup:31';

describe('addTickets', () => {
  it.each([[undefined], ['']])('does nothing when TICKETING_PROVIDER is %p', async (value) => {
    setProvider(value);
    await addTickets({ 'acc-1': [volunteer] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('does nothing when there are no accounts', async () => {
    await addTickets({});
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('inserts a single ticket for an account', async () => {
    await addTickets({ 'acc-1': [volunteer] });
    const { sql, params } = lastQuery();
    expect(sql).toContain('INSERT INTO account_ticket ("accountId", "ticket")');
    expect(sql).toContain('VALUES ($1, $2)');
    expect(params).toEqual(['acc-1', VOLUNTEER]);
  });

  it('inserts several tickets for one account in a single statement', async () => {
    await addTickets({ 'acc-1': [volunteer, dayPass] });
    const { sql, params } = lastQuery();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(sql).toContain('VALUES ($1, $2), ($3, $4)');
    expect(params).toEqual(['acc-1', VOLUNTEER, 'acc-1', DAY_PASS]);
  });

  it('inserts tickets for several accounts in a single statement, keeping each ticket with its own account', async () => {
    await addTickets({ 'acc-1': [volunteer, dayPass], 'acc-2': [meetup] });
    const { sql, params } = lastQuery();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(sql).toContain('VALUES ($1, $2), ($3, $4), ($5, $6)');
    expect(params).toEqual(['acc-1', VOLUNTEER, 'acc-1', DAY_PASS, 'acc-2', MEETUP]);
  });

  it('passes a flat list of parameters, not nested pairs', async () => {
    await addTickets({ 'acc-1': [volunteer], 'acc-2': [meetup] });
    const { params } = lastQuery();
    expect(params.every((param: unknown) => typeof param === 'string')).toBe(true);
  });

  it('serialises every ticket with ticketToString', async () => {
    await addTickets({ 'acc-1': [volunteer, dayPass], 'acc-2': [meetup] });
    expect(mockTicketToString).toHaveBeenCalledTimes(3);
    expect(mockTicketToString).toHaveBeenCalledWith(volunteer);
    expect(mockTicketToString).toHaveBeenCalledWith(dayPass);
    expect(mockTicketToString).toHaveBeenCalledWith(meetup);
  });

  it('ignores tickets that are already saved for the account', async () => {
    await addTickets({ 'acc-1': [volunteer] });
    expect(lastQuery().sql).toContain('ON CONFLICT ("accountId", "ticket") DO NOTHING');
  });

  it('skips accounts that have no tickets, and still saves the others', async () => {
    await addTickets({ 'acc-1': [], 'acc-2': [meetup] });
    const { sql, params } = lastQuery();
    expect(sql).toContain('VALUES ($1, $2)');
    expect(sql).not.toContain('($3, $4)');
    expect(params).toEqual(['acc-2', MEETUP]);
  });

  it('uses the pool when no client is given', async () => {
    await addTickets({ 'acc-1': [volunteer] });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    await addTickets({ 'acc-1': [volunteer] }, client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(lastQuery(query).params).toEqual(['acc-1', VOLUNTEER]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('propagates database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('insert failed'));
    await expect(addTickets({ 'acc-1': [volunteer] })).rejects.toThrow('insert failed');
  });

  describe('when every account has an empty ticket list', () => {
    it('does not run a query', async () => {
      await addTickets({ 'acc-1': [], 'acc-2': [] });
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});

// --- removeTickets ------------------------------------------------------------------

describe('removeTickets', () => {
  it.each([[undefined], ['']])('does nothing when TICKETING_PROVIDER is %p', async (value) => {
    setProvider(value);
    await removeTickets({ 'acc-1': [volunteer] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('does nothing when there are no accounts', async () => {
    await removeTickets({});
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('removes a single ticket from an account', async () => {
    await removeTickets({ 'acc-1': [volunteer] });
    const { sql, params } = lastQuery();
    expect(sql).toContain('DELETE FROM account_ticket');
    expect(sql).toContain('WHERE ("accountId", "ticket") IN (($1, $2))');
    expect(params).toEqual(['acc-1', VOLUNTEER]);
  });

  it('removes several tickets from one account in a single statement', async () => {
    await removeTickets({ 'acc-1': [volunteer, dayPass] });
    const { sql, params } = lastQuery();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(sql).toContain('IN (($1, $2), ($3, $4))');
    expect(params).toEqual(['acc-1', VOLUNTEER, 'acc-1', DAY_PASS]);
  });

  it('removes tickets from several accounts in a single statement', async () => {
    await removeTickets({ 'acc-1': [volunteer, dayPass], 'acc-2': [meetup] });
    const { sql, params } = lastQuery();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(sql).toContain('IN (($1, $2), ($3, $4), ($5, $6))');
    expect(params).toEqual(['acc-1', VOLUNTEER, 'acc-1', DAY_PASS, 'acc-2', MEETUP]);
  });

  it('passes a flat list of parameters, not nested pairs', async () => {
    await removeTickets({ 'acc-1': [volunteer], 'acc-2': [meetup] });
    const { params } = lastQuery();
    expect(params.every((param: unknown) => typeof param === 'string')).toBe(true);
  });

  it('serialises every ticket with ticketToString', async () => {
    await removeTickets({ 'acc-1': [volunteer, dayPass], 'acc-2': [meetup] });
    expect(mockTicketToString).toHaveBeenCalledTimes(3);
    expect(mockTicketToString).toHaveBeenCalledWith(volunteer);
    expect(mockTicketToString).toHaveBeenCalledWith(dayPass);
    expect(mockTicketToString).toHaveBeenCalledWith(meetup);
  });

  it('skips accounts that have no removals, and still remove the others', async () => {
    await removeTickets({ 'acc-1': [], 'acc-2': [meetup] });
    const { sql, params } = lastQuery();
    expect(sql).toContain('IN (($1, $2))');
    expect(sql).not.toContain('($3, $4)');
    expect(params).toEqual(['acc-2', MEETUP]);
  });

  it('uses the pool when no client is given', async () => {
    await removeTickets({ 'acc-1': [volunteer] });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    await removeTickets({ 'acc-1': [volunteer] }, client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(lastQuery(query).params).toEqual(['acc-1', VOLUNTEER]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('propagates database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('remove failed'));
    await expect(removeTickets({ 'acc-1': [volunteer] })).rejects.toThrow('remove failed');
  });

  describe('when every account has an empty ticket list', () => {
    it('does not run a query', async () => {
      await removeTickets({ 'acc-1': [], 'acc-2': [] });
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});

// --- saveTicketSyncHistory ------------------------------------------------------

describe('saveTicketSyncHistory', () => {
  // Cast through unknown so these tests don't depend on the exact TicketSyncHistoryStatus type
  const status = (value: string) => value as unknown as TicketSyncHistoryStatus;

  it.each([[undefined], ['']])('does nothing when TICKETING_PROVIDER is %p', async (value) => {
    setProvider(value);
    await saveTicketSyncHistory('pretix', status('success'));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('inserts one row with the provider and status', async () => {
    await saveTicketSyncHistory('pretix', status('success'));
    const { sql, params } = lastQuery();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(sql).toContain('INSERT INTO ticket_sync_history ("provider", "status")');
    expect(sql).toContain('VALUES ($1, $2)');
    expect(params).toEqual(['pretix', 'success']);
  });

  it.each([['success'], ['failure'], ['partial']])(
    'records a "%s" status as given',
    async (value) => {
      await saveTicketSyncHistory('pretix', status(value));
      expect(lastQuery().params).toEqual(['pretix', value]);
    }
  );

  it('uses the pool when no client is given', async () => {
    await saveTicketSyncHistory('pretix', status('success'));
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    await saveTicketSyncHistory('pretix', status('success'), client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(lastQuery(query).params).toEqual(['pretix', 'success']);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('propagates database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('insert failed'));
    await expect(saveTicketSyncHistory('pretix', status('success'))).rejects.toThrow(
      'insert failed'
    );
  });
});

// --- getTicketsForUser -------------------------------------------------------------

describe('getTicketsForUser', () => {
  const USER_ID = 'user-1';

  it.each([[undefined], ['']])(
    'returns an empty array without querying when TICKETING_PROVIDER is %p',
    async (value) => {
      setProvider(value);
      await expect(getTicketsForUser(USER_ID)).resolves.toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    }
  );

  it('looks up the tickets of the user’s accounts', async () => {
    await getTicketsForUser(USER_ID);
    const { sql, params } = lastQuery();
    expect(sql).toContain('FROM account_ticket');
    expect(sql).toContain('JOIN account ON account_ticket."accountId" = account."accountId"');
    expect(sql).toContain('WHERE account."userId" = $1');
    expect(params).toEqual([USER_ID]);
  });

  it('returns an empty array when the user has no tickets', async () => {
    await expect(getTicketsForUser(USER_ID)).resolves.toEqual([]);
    expect(mockTicketFromString).not.toHaveBeenCalled();
  });

  it('converts each row’s ticket string to a Ticket, in row order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ticket: VOLUNTEER }, { ticket: MEETUP }] });

    const tickets = await getTicketsForUser(USER_ID);

    expect(tickets).toEqual([volunteer, meetup]);
    expect(mockTicketFromString).toHaveBeenCalledTimes(2);
    expect(mockTicketFromString).toHaveBeenCalledWith(VOLUNTEER);
    expect(mockTicketFromString).toHaveBeenCalledWith(MEETUP);
  });

  it('propagates database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection lost'));
    await expect(getTicketsForUser(USER_ID)).rejects.toThrow('connection lost');
  });

  it('propagates errors from parsing a malformed ticket string', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ticket: 'garbage' }] });
    mockTicketFromString.mockImplementationOnce(() => {
      throw new Error('Invalid ticket string');
    });
    await expect(getTicketsForUser(USER_ID)).rejects.toThrow('Invalid ticket string');
  });
});
