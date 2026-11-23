import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import pool from '@/db';
import { canAccess } from '@/utils/permissions';
import { usersToVolunteers, userToVolunteer } from '@/lib/volunteer';
import {
  getUser,
  getUsers,
  getFilteredUsers,
  getFilteredVolunteers,
  getUsersWithRole,
  getUserRoles,
  createUser,
  updateUser,
  addRoleToUsers,
  removeRoleFromUsers,
  getRoleCount,
  markUserAsDeleted,
  undeleteUser,
  getTeamLeadsForTeam,
  getVolunteersForShifts,
  getUserIdsForAccountIds
} from './user-service';

// --- Mocks -----------------------------------------------------------------

jest.mock('@/db', () => ({
  __esModule: true,
  default: { query: jest.fn() }
}));

// React's cache() only memoizes inside server components. Make it a passthrough
// so every call in a test hits the (mocked) database.
jest.mock('react', () => ({
  cache: <T extends (...args: any[]) => any>(fn: T) => fn
}));

jest.mock('node:crypto', () => ({ randomUUID: jest.fn() }));

jest.mock('@/utils/permissions', () => ({ canAccess: jest.fn() }));

jest.mock('@/lib/volunteer', () => ({
  usersToVolunteers: jest.fn(),
  userToVolunteer: jest.fn()
}));

const mockQuery = pool.query as unknown as jest.Mock;
const mockCanAccess = canAccess as unknown as jest.Mock;
const mockUsersToVolunteers = usersToVolunteers as unknown as jest.Mock;
const mockUserToVolunteer = userToVolunteer as unknown as jest.Mock;
const mockRandomUUID = randomUUID as unknown as jest.Mock;

// --- Helpers ---------------------------------------------------------------

const normalise = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/** Returns the SQL (whitespace-collapsed) and params of the most recent pool.query call. */
const lastQuery = (query: jest.Mock = mockQuery) => {
  const calls = query.mock.calls;
  const [sql, params] = calls[calls.length - 1];
  return { sql: normalise(sql), params };
};

const mockRows = (rows: any[]) => mockQuery.mockResolvedValueOnce({ rows });

const userRow = (overrides: Record<string, any> = {}) => ({
  id: 'u1',
  name: 'Alice Smith',
  chosenName: 'Ali',
  email: 'alice@example.com',
  deletedAt: null,
  type: null,
  eventId: null,
  teamId: null,
  ...overrides
});

const makeClient = () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  return { client: { query } as unknown as PoolClient, query };
};

const profile: PermissionsProfile = {
  userId: 'requester',
  admin: false,
  organiser: false,
  'team-lead': false
};

beforeEach(() => {
  jest.resetAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

// --- getUser (also exercises usersFromRows / roleFromRow) -------------------

describe('getUser', () => {
  it('returns null when no rows are found', async () => {
    await expect(getUser('u1')).resolves.toBeNull();
  });

  it('passes the user id and a null event id when no event is given', async () => {
    await getUser('u1');
    expect(lastQuery().params).toEqual(['u1', null]);
  });

  it('passes the event id through when given', async () => {
    await getUser('u1', 'event-1');
    expect(lastQuery().params).toEqual(['u1', 'event-1']);
  });

  it('maps a row with no role (LEFT JOIN miss) to a user with empty roles', async () => {
    mockRows([userRow()]);
    await expect(getUser('u1')).resolves.toEqual({
      id: 'u1',
      name: 'Alice Smith',
      chosenName: 'Ali',
      email: 'alice@example.com',
      roles: [],
      deletedAt: undefined
    });
  });

  it('collects multiple role rows into a single user', async () => {
    mockRows([
      userRow({ type: 'admin' }),
      userRow({ type: 'organiser', eventId: 'e1' }),
      userRow({ type: 'team-lead', eventId: 'e1', teamId: 't1' })
    ]);
    const user = await getUser('u1', 'e1');
    expect(user?.roles).toEqual([
      { type: 'admin' },
      { type: 'organiser', eventId: 'e1' },
      { type: 'team-lead', eventId: 'e1', teamId: 't1' }
    ]);
  });

  it('keeps a Date deletedAt as-is', async () => {
    const deletedAt = new Date('2025-01-01T00:00:00Z');
    mockRows([userRow({ deletedAt })]);
    const user = await getUser('u1');
    expect(user?.deletedAt).toEqual(deletedAt);
  });

  it('converts a string deletedAt to a Date', async () => {
    mockRows([userRow({ deletedAt: '2025-01-01T00:00:00.000Z' })]);
    const user = await getUser('u1');
    expect(user?.deletedAt).toBeInstanceOf(Date);
    expect(user?.deletedAt?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('throws when an organiser role has no eventId', async () => {
    mockRows([userRow({ type: 'organiser' })]);
    await expect(getUser('u1')).rejects.toThrow('Organiser role missing eventId for user u1');
  });

  it('throws when a team-lead role has no teamId', async () => {
    mockRows([userRow({ type: 'team-lead', eventId: 'e1' })]);
    await expect(getUser('u1')).rejects.toThrow(
      'Team-lead role missing eventId or teamId for user u1'
    );
  });

  it('throws when a team-lead role has no eventId', async () => {
    mockRows([userRow({ type: 'team-lead', teamId: 't1' })]);
    await expect(getUser('u1')).rejects.toThrow(
      'Team-lead role missing eventId or teamId for user u1'
    );
  });

  it('throws on an unknown role type', async () => {
    mockRows([userRow({ type: 'wizard' })]);
    await expect(getUser('u1')).rejects.toThrow('Unknown role type: wizard');
  });
});

// --- getUsers ----------------------------------------------------------------

describe('getUsers', () => {
  it('returns an empty array when there are no users', async () => {
    await expect(getUsers()).resolves.toEqual([]);
  });

  it('passes a null event id when none is given, and the event id otherwise', async () => {
    await getUsers();
    expect(lastQuery().params).toEqual([null]);
    await getUsers('event-1');
    expect(lastQuery().params).toEqual(['event-1']);
  });

  it('groups rows by user id and preserves order', async () => {
    mockRows([
      userRow({ id: 'u1', type: 'admin' }),
      userRow({ id: 'u2', name: 'Bob', chosenName: 'Bobby', email: 'bob@example.com' }),
      userRow({ id: 'u1', type: 'organiser', eventId: 'e1' })
    ]);
    const users = await getUsers('e1');
    expect(users.map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(users[0].roles).toHaveLength(2);
    expect(users[1].roles).toEqual([]);
  });
});

// --- getFilteredUsers ---------------------------------------------------------

describe('getFilteredUsers', () => {
  it('excludes deleted users by default', async () => {
    await getFilteredUsers({}, profile);
    const { sql, params } = lastQuery();
    expect(sql).toContain('WHERE u."deletedAt" IS NULL');
    expect(params).toEqual([null]);
  });

  it('adds no WHERE clause when showDeleted is true and nothing else is filtered', async () => {
    await getFilteredUsers({ showDeleted: true }, profile);
    expect(lastQuery().sql).not.toContain('WHERE');
  });

  it('orders results by chosenName', async () => {
    await getFilteredUsers({}, profile);
    expect(lastQuery().sql).toMatch(/ORDER BY u\."chosenName" ASC$/);
  });

  describe('searchQuery', () => {
    it('searches chosenName, email and name when the requester can access all of them', async () => {
      mockCanAccess.mockReturnValue(true);
      await getFilteredUsers({ searchQuery: 'ali' }, profile, 'e1');
      const { sql, params } = lastQuery();
      expect(sql).toContain('(u."chosenName" ILIKE $2 OR u.email ILIKE $2 OR u.name ILIKE $2)');
      expect(params).toEqual(['e1', '%ali%']);
      expect(mockCanAccess).toHaveBeenCalledWith('VolunteerInfo', 'fullName', profile);
      expect(mockCanAccess).toHaveBeenCalledWith('VolunteerInfo', 'email', profile);
    });

    it('only searches chosenName when the requester cannot access name or email', async () => {
      mockCanAccess.mockReturnValue(false);
      await getFilteredUsers({ searchQuery: 'ali' }, profile);
      const { sql } = lastQuery();
      expect(sql).toContain('(u."chosenName" ILIKE $2)');
      expect(sql).not.toContain('u.email ILIKE');
      expect(sql).not.toContain('u.name ILIKE');
    });

    it('includes email but not full name when only email is accessible', async () => {
      mockCanAccess.mockImplementation((_type: string, field: string) => field === 'email');
      await getFilteredUsers({ searchQuery: 'ali' }, profile);
      const { sql } = lastQuery();
      expect(sql).toContain('u.email ILIKE $2');
      expect(sql).not.toContain('u.name ILIKE');
    });

    it('includes full name but not email when only fullName is accessible', async () => {
      mockCanAccess.mockImplementation((_type: string, field: string) => field === 'fullName');
      await getFilteredUsers({ searchQuery: 'ali' }, profile);
      const { sql } = lastQuery();
      expect(sql).toContain('u.name ILIKE $2');
      expect(sql).not.toContain('u.email ILIKE');
    });

    it('does not consult permissions when there is no search query', async () => {
      await getFilteredUsers({}, profile);
      expect(mockCanAccess).not.toHaveBeenCalled();
    });
  });

  it('filters by role type, scoped to the event', async () => {
    await getFilteredUsers({ roleType: 'organiser' }, profile, 'e1');
    const { sql, params } = lastQuery();
    expect(sql).toContain('r.type = $2');
    expect(sql).toContain('(r."eventId" IS NULL OR r."eventId" = $3)');
    expect(params).toEqual(['e1', 'organiser', 'e1']);
  });

  it('filters by required qualification', async () => {
    await getFilteredUsers({ withQualification: 'q1' }, profile);
    const { sql, params } = lastQuery();
    expect(sql).toContain('EXISTS (SELECT 1 FROM user_qualification uq');
    expect(sql).not.toContain('NOT EXISTS');
    expect(sql).toContain('uq."qualificationId" = $2');
    expect(params).toEqual([null, 'q1']);
  });

  it('filters by missing qualification', async () => {
    await getFilteredUsers({ withoutQualification: 'q2' }, profile);
    const { sql, params } = lastQuery();
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM user_qualification uq');
    expect(sql).toContain('uq."qualificationId" = $2');
    expect(params).toEqual([null, 'q2']);
  });

  it('filters by team', async () => {
    await getFilteredUsers({ onTeam: 't1' }, profile);
    const { sql, params } = lastQuery();
    expect(sql).toContain('s."teamId" = $2');
    expect(params).toEqual([null, 't1']);
  });

  it('filters by minimum event hours', async () => {
    await getFilteredUsers({ eventHours: 8 }, profile, 'e1');
    const { sql, params } = lastQuery();
    expect(sql).toContain('t."eventId"=$2');
    expect(sql).toContain('>= $3');
    expect(params).toEqual(['e1', 'e1', 8]);
  });

  it('applies an eventHours filter of 0 rather than treating it as unset', async () => {
    await getFilteredUsers({ eventHours: 0 }, profile, 'e1');
    expect(lastQuery().params).toEqual(['e1', 'e1', 0]);
  });

  it('numbers parameters correctly when several filters are combined', async () => {
    mockCanAccess.mockReturnValue(true);
    await getFilteredUsers(
      { searchQuery: 'ali', roleType: 'admin', withQualification: 'q1', onTeam: 't1' },
      profile,
      'e1'
    );
    const { sql, params } = lastQuery();
    expect(params).toEqual(['e1', '%ali%', 'admin', 'e1', 'q1', 't1']);
    expect(sql).toContain('ILIKE $2');
    expect(sql).toContain('r.type = $3');
    expect(sql).toContain('r."eventId" = $4');
    expect(sql).toContain('uq."qualificationId" = $5');
    expect(sql).toContain('s."teamId" = $6');
    expect(sql).toContain('u."deletedAt" IS NULL');
    expect(sql.match(/ AND /g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('returns users built from the result rows', async () => {
    mockRows([userRow({ type: 'admin' })]);
    const users = await getFilteredUsers({}, profile);
    expect(users).toHaveLength(1);
    expect(users[0].roles).toEqual([{ type: 'admin' }]);
  });
});

// --- getFilteredVolunteers -------------------------------------------------------

describe('getFilteredVolunteers', () => {
  it('converts the filtered users to volunteers using the permissions profile', async () => {
    const volunteers: VolunteerInfo[] = [{ id: 'v1', displayName: 'Ali' }];
    mockUsersToVolunteers.mockReturnValue(volunteers);
    mockRows([userRow()]);

    const result = await getFilteredVolunteers({}, profile, 'e1');

    expect(result).toBe(volunteers);
    expect(mockUsersToVolunteers).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'u1' })],
      profile
    );
  });
});

// --- getUsersWithRole ------------------------------------------------------------

describe('getUsersWithRole', () => {
  it('queries for admins using only the role type', async () => {
    await getUsersWithRole({ type: 'admin' }, 'e0');
    const { sql, params } = lastQuery();
    expect(sql).toContain('WHERE EXISTS (select 1 from role where "userId" = u.id and type=$2)');
    expect(params).toEqual(['e0', 'admin']);
  });

  it('adds the role event id for organisers', async () => {
    await getUsersWithRole({ type: 'organiser', eventId: 'e1' }, 'e0');
    const { sql, params } = lastQuery();
    expect(sql).toContain('type=$2 AND "eventId" = $3)');
    expect(params).toEqual(['e0', 'organiser', 'e1']);
  });

  it('adds both event and team ids for team leads', async () => {
    await getUsersWithRole({ type: 'team-lead', eventId: 'e1', teamId: 't1' });
    const { sql, params } = lastQuery();
    expect(sql).toContain('"eventId" = $3 AND "teamId" = $4');
    expect(params).toEqual([null, 'team-lead', 'e1', 't1']);
  });

  it('returns users built from the rows', async () => {
    mockRows([userRow({ type: 'admin' })]);
    const users = await getUsersWithRole({ type: 'admin' });
    expect(users.map((u) => u.id)).toEqual(['u1']);
  });
});

// --- getUserRoles ----------------------------------------------------------------

describe('getUserRoles', () => {
  it('queries by user and event id', async () => {
    await getUserRoles('u1', 'e1');
    expect(lastQuery().params).toEqual(['u1', 'e1']);
  });

  it('returns an empty array when the user has no roles', async () => {
    await expect(getUserRoles('u1', 'e1')).resolves.toEqual([]);
  });

  it('maps rows to roles', async () => {
    mockRows([
      { type: 'admin', eventId: null, teamId: null },
      { type: 'organiser', eventId: 'e1', teamId: null },
      { type: 'team-lead', eventId: 'e1', teamId: 't1' }
    ]);
    await expect(getUserRoles('u1', 'e1')).resolves.toEqual([
      { type: 'admin' },
      { type: 'organiser', eventId: 'e1' },
      { type: 'team-lead', eventId: 'e1', teamId: 't1' }
    ]);
  });

  it('throws on a malformed role row', async () => {
    mockRows([{ id: 'u1', type: 'organiser', eventId: null, teamId: null }]);
    await expect(getUserRoles('u1', 'e1')).rejects.toThrow('Organiser role missing eventId');
  });
});

// --- createUser -------------------------------------------------------------------

describe('createUser', () => {
  const input: UserCreationModel = {
    name: 'Alice Smith',
    chosenName: 'Ali',
    email: 'alice@example.com'
  };

  beforeEach(() => {
    mockRandomUUID.mockReturnValue('generated-uuid');
  });

  it('inserts with a generated id and emailVerified=false', async () => {
    mockRows([{ id: 'generated-uuid', ...input }]);
    await createUser(input);
    const { sql, params } = lastQuery();
    expect(sql).toContain('INSERT INTO "user"');
    expect(params).toEqual(['generated-uuid', 'Alice Smith', 'Ali', 'alice@example.com', false]);
  });

  it('returns the created user with no roles', async () => {
    mockRows([{ id: 'generated-uuid', ...input }]);
    await expect(createUser(input)).resolves.toEqual({
      id: 'generated-uuid',
      name: 'Alice Smith',
      chosenName: 'Ali',
      email: 'alice@example.com',
      roles: []
    });
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValueOnce({ rows: [{ id: 'generated-uuid', ...input }] });
    await createUser(input, client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('propagates database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('duplicate key'));
    await expect(createUser(input)).rejects.toThrow('duplicate key');
  });
});

// --- updateUser -------------------------------------------------------------------

describe('updateUser', () => {
  // UserUpdateModel is Omit<User, 'roles' | 'chosenName'>, so it still requires an id
  const update: UserUpdateModel = {
    id: 'u1',
    name: 'New Name',
    chosenName: 'New',
    email: 'new@example.com'
  };

  it('updates name, chosenName and email for the given user', async () => {
    await updateUser('u1', update);
    const { sql, params } = lastQuery();
    expect(sql).toContain('UPDATE "user"');
    expect(params).toEqual(['New Name', 'New', 'new@example.com', 'u1']);
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    await updateUser('u1', update, client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// --- addRoleToUsers ---------------------------------------------------------------

describe('addRoleToUsers', () => {
  it('does nothing when the user list is empty', async () => {
    await addRoleToUsers({ type: 'admin' }, []);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it('adds the admin role', async () => {
    await addRoleToUsers({ type: 'admin' }, ['u1', 'u2']);
    const { sql, params } = lastQuery();
    expect(sql).toContain('INSERT INTO role ("userId", "type")');
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(params).toEqual([['u1', 'u2'], 'admin']);
  });

  it('adds the organiser role with an event id', async () => {
    await addRoleToUsers({ type: 'organiser', eventId: 'e1' }, ['u1']);
    const { sql, params } = lastQuery();
    expect(sql).toContain('INSERT INTO role ("userId", "type", "eventId")');
    expect(params).toEqual([['u1'], 'organiser', 'e1']);
  });

  it('adds the team-lead role with event and team ids', async () => {
    await addRoleToUsers({ type: 'team-lead', eventId: 'e1', teamId: 't1' }, ['u1']);
    const { sql, params } = lastQuery();
    expect(sql).toContain('INSERT INTO role ("userId", "type", "eventId", "teamId")');
    expect(params).toEqual([['u1'], 'team-lead', 'e1', 't1']);
  });

  it('rejects an organiser role without an eventId and does not query', async () => {
    await expect(
      addRoleToUsers({ type: 'organiser' } as unknown as UserRole, ['u1'])
    ).rejects.toThrow('Organiser role requires an eventId');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['missing teamId', { type: 'team-lead', eventId: 'e1' }],
    ['missing eventId', { type: 'team-lead', teamId: 't1' }]
  ])('rejects a team-lead role with %s', async (_label, role) => {
    await expect(addRoleToUsers(role as unknown as UserRole, ['u1'])).rejects.toThrow(
      'Team-lead role requires both eventId and teamId'
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects an unknown role type', async () => {
    await expect(addRoleToUsers({ type: 'wizard' } as unknown as UserRole, ['u1'])).rejects.toThrow(
      'Invalid role:'
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('logs how many users received the role', async () => {
    await addRoleToUsers({ type: 'admin' }, ['u1', 'u2']);
    expect(console.info).toHaveBeenCalledWith('Added role {"type":"admin"} to 2 user(s)');
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    await addRoleToUsers({ type: 'admin' }, ['u1'], client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// --- removeRoleFromUsers ---------------------------------------------------------

describe('removeRoleFromUsers', () => {
  it('removes a global role by type and user ids', async () => {
    await removeRoleFromUsers({ type: 'admin' }, ['u1', 'u2']);
    const { sql, params } = lastQuery();
    expect(sql).toBe('DELETE FROM role WHERE type = $1 AND "userId" = ANY($2::text[])');
    expect(params).toEqual(['admin', ['u1', 'u2']]);
  });

  it('scopes organiser removal to the event', async () => {
    await removeRoleFromUsers({ type: 'organiser', eventId: 'e1' }, ['u1']);
    const { sql, params } = lastQuery();
    expect(sql).toBe(
      'DELETE FROM role WHERE type = $1 AND "userId" = ANY($2::text[]) AND "eventId" = $3'
    );
    expect(params).toEqual(['organiser', ['u1'], 'e1']);
  });

  it('scopes team-lead removal to the event and team', async () => {
    await removeRoleFromUsers({ type: 'team-lead', eventId: 'e1', teamId: 't1' }, ['u1']);
    const { sql, params } = lastQuery();
    expect(sql).toBe(
      'DELETE FROM role WHERE type = $1 AND "userId" = ANY($2::text[]) AND "eventId" = $3 AND "teamId" = $4'
    );
    expect(params).toEqual(['team-lead', ['u1'], 'e1', 't1']);
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    await removeRoleFromUsers({ type: 'admin' }, ['u1'], client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// --- getRoleCount ----------------------------------------------------------------

describe('getRoleCount', () => {
  it('parses the count returned by the database', async () => {
    mockRows([{ count: '5' }]);
    await expect(getRoleCount('admin')).resolves.toBe(5);
    expect(lastQuery().params).toEqual(['admin']);
  });

  it('only counts non-deleted users', async () => {
    mockRows([{ count: '0' }]);
    await getRoleCount('admin');
    expect(lastQuery().sql).toContain('u."deletedAt" IS NULL');
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValueOnce({ rows: [{ count: '3' }] });
    await expect(getRoleCount('admin', client)).resolves.toBe(3);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// --- markUserAsDeleted / undeleteUser -------------------------------------------

describe('markUserAsDeleted', () => {
  it('sets deletedAt for the user', async () => {
    await markUserAsDeleted('u1');
    expect(lastQuery()).toEqual({
      sql: 'UPDATE "user" SET "deletedAt" = CURRENT_TIMESTAMP WHERE id = $1',
      params: ['u1']
    });
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    await markUserAsDeleted('u1', client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('undeleteUser', () => {
  it('clears deletedAt for the user', async () => {
    await undeleteUser('u1');
    expect(lastQuery()).toEqual({
      sql: 'UPDATE "user" SET "deletedAt" = NULL WHERE id = $1',
      params: ['u1']
    });
  });

  it('uses the provided client instead of the pool', async () => {
    const { client, query } = makeClient();
    await undeleteUser('u1', client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// --- getTeamLeadsForTeam ---------------------------------------------------------

describe('getTeamLeadsForTeam', () => {
  it('queries by event id and team id', async () => {
    await getTeamLeadsForTeam('t1', 'e1');
    const { sql, params } = lastQuery();
    expect(sql).toContain(`r.type = 'team-lead' AND r."teamId" = $2`);
    expect(params).toEqual(['e1', 't1']);
  });

  it('returns an empty array when there are no team leads', async () => {
    await expect(getTeamLeadsForTeam('t1', 'e1')).resolves.toEqual([]);
  });

  it('returns the team leads with their roles', async () => {
    mockRows([userRow({ type: 'team-lead', eventId: 'e1', teamId: 't1' })]);
    const leads = await getTeamLeadsForTeam('t1', 'e1');
    expect(leads).toHaveLength(1);
    expect(leads[0].roles).toEqual([{ type: 'team-lead', eventId: 'e1', teamId: 't1' }]);
  });
});

// --- getVolunteersForShifts ------------------------------------------------------

describe('getVolunteersForShifts', () => {
  beforeEach(() => {
    mockUserToVolunteer.mockImplementation((user: any) => ({ id: user.id }));
  });

  it('returns an empty record without querying when there are no shift ids', async () => {
    await expect(getVolunteersForShifts([], profile, 'e1')).resolves.toEqual({});
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('queries by shift ids and event id', async () => {
    await getVolunteersForShifts(['s1', 's2'], profile, 'e1');
    expect(lastQuery().params).toEqual([['s1', 's2'], 'e1']);
  });

  it('groups volunteers by shift', async () => {
    mockRows([
      userRow({ id: 'u1', shift_id: 's1' }),
      userRow({ id: 'u2', shift_id: 's1' }),
      userRow({ id: 'u1', shift_id: 's2' })
    ]);
    const result = await getVolunteersForShifts(['s1', 's2'], profile, 'e1');
    expect(result).toEqual({
      s1: [{ id: 'u1' }, { id: 'u2' }],
      s2: [{ id: 'u1' }]
    });
    expect(mockUserToVolunteer).toHaveBeenCalledTimes(3);
    expect(mockUserToVolunteer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      profile
    );
  });

  it('lists a volunteer once per shift even when they have several role rows', async () => {
    mockRows([
      userRow({ id: 'u1', shift_id: 's1', type: null }),
      userRow({ id: 'u1', shift_id: 's1', type: 'admin' })
    ]);
    const result = await getVolunteersForShifts(['s1'], profile, 'e1');
    expect(result.s1).toEqual([{ id: 'u1' }]);
    expect(mockUserToVolunteer).toHaveBeenCalledTimes(1);
  });

  it('omits shifts that have no volunteers', async () => {
    mockRows([userRow({ id: 'u1', shift_id: 's1' })]);
    const result = await getVolunteersForShifts(['s1', 's2'], profile, 'e1');
    expect(Object.keys(result)).toEqual(['s1']);
  });
});

// --- getUserIdsForAccountIds -----------------------------------------------------

describe('getUserIdsForAccountIds', () => {
  it('returns an empty array without querying when there are no account ids', async () => {
    await expect(getUserIdsForAccountIds([], 'pretix')).resolves.toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns the user ids from the result rows', async () => {
    mockRows([
      { accountId: 'a1', userId: 'u1' },
      { accountId: 'a2', userId: 'u2' }
    ]);
    await expect(getUserIdsForAccountIds(['a1', 'a2'], 'pretix')).resolves.toEqual(['u1', 'u2']);
  });

  it('returns an empty array when no accounts match', async () => {
    await expect(getUserIdsForAccountIds(['nope'], 'pretix')).resolves.toEqual([]);
  });
});
