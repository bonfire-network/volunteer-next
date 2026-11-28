/**
 * Service for managing tickets and ticket requirements in the database
 * @since 2026-11-26
 * @author Michael Townsend <@continuities>
 */

import pool from '@/db';
import { ticketFromString, ticketToString } from '@/utils/ticket';
import { PoolClient } from 'pg';

/**
 * Fetches ticket requirements for an event
 * @param event The eventId for which to fetch ticket requirements
 * @returns A promise resolving to a list of Ticket objects
 */
export const getTicketRequirementsForEvent = async (event: EventId): Promise<Ticket[]> => {
  if (!process.env.TICKETING_PROVIDER) {
    return [];
  }
  const res = await pool.query(
    `
        SELECT
          "eventId",
          "ticket"
        FROM ticket_requirement
        WHERE "eventId" = $1
     `,
    [event]
  );
  return res.rows.map((row) => ticketFromString(row.ticket));
};

/**
 * Adds ticket requirements to an event
 * @param event The eventId for which to add ticket requirements
 * @param toAdd List of TicketStrings to add to the event
 * @param client Optional PoolClient for transactions
 * @returns Promise<void>
 */
export const addTicketRequirementsToEvent = async (
  event: EventId,
  toAdd: TicketString[],
  client?: PoolClient
) => {
  if (!process.env.TICKETING_PROVIDER || toAdd.length === 0) {
    return;
  }
  const db = client || pool;
  const placeholders = toAdd
    .map((_, index) => {
      const base = index * 2;
      return `($${base + 1}, $${base + 2})`;
    })
    .join(', ');
  const params = toAdd.flatMap((ticket) => [event, ticket]);
  await db.query(
    `
      INSERT INTO "ticket_requirement" ("eventId", "ticket")
      VALUES ${placeholders}
      ON CONFLICT ("eventId", "ticket") DO NOTHING
    `,
    params
  );
};

/**
 * Removes ticket requirements from an event
 * @param event The eventId for which to remove ticket requirements
 * @param toAdd List of TicketStrings to remove from the event
 * @param client Optional PoolClient for transactions
 * @returns Promise<void>
 */
export const removeTicketRequirementsFromEvent = async (
  event: EventId,
  toRemove: TicketString[],
  client?: PoolClient
) => {
  if (!process.env.TICKETING_PROVIDER || toRemove.length === 0) {
    return;
  }
  const db = client || pool;
  await db.query(
    `
    DELETE FROM ticket_requirement
    WHERE "eventId" = $1
    AND "ticket" = ANY($2::text[])
    `,
    [event, toRemove]
  );
};

const getAccountTicketParams = (accountTickets: Record<AccountId, OrderedTicket[]>) => {
  const accountIdsParam: AccountId[] = [];
  const ticketsParam: TicketString[] = [];
  const orderRefsParam: string[] = [];
  for (const [accountId, tickets] of Object.entries(accountTickets)) {
    for (const ticket of tickets) {
      accountIdsParam.push(accountId);
      ticketsParam.push(ticketToString(ticket));
      orderRefsParam.push(ticket.orderRef);
    }
  }
  return { accountIdsParam, ticketsParam, orderRefsParam };
};

/**
 * Saves tickets to the database, by accountId
 * @param accountTickets Tickets to add, by AccountId
 * @param client Optional PoolClient for transactions
 * @returns Promise<void>
 */
export const addTickets = async (
  accountTickets: Record<AccountId, OrderedTicket[]>,
  client?: PoolClient
) => {
  if (!process.env.TICKETING_PROVIDER) {
    return;
  }
  const db = client || pool;
  const { accountIdsParam, ticketsParam, orderRefsParam } = getAccountTicketParams(accountTickets);

  if (accountIdsParam.length === 0) {
    return;
  }

  await db.query(
    `
    INSERT INTO account_ticket ("accountId", "ticket", "orderRef")
    SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
    ON CONFLICT DO NOTHING
    `,
    [accountIdsParam, ticketsParam, orderRefsParam]
  );
};

/**
 * Removes tickets from the database, by accountId
 * @param accountTickets Tickets to remove, by AccountId
 * @param client Optional PoolClient for transactions
 * @returns Promise<void>
 */
export const removeTickets = async (
  accountTickets: Record<AccountId, OrderedTicket[]>,
  client?: PoolClient
) => {
  if (!process.env.TICKETING_PROVIDER) {
    return;
  }
  const db = client || pool;
  const { accountIdsParam, ticketsParam, orderRefsParam } = getAccountTicketParams(accountTickets);
  if (accountIdsParam.length === 0) {
    return;
  }

  await db.query(
    `
    DELETE FROM account_ticket
    WHERE ("accountId", "ticket", "orderRef") IN (
      SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
    )
    `,
    [accountIdsParam, ticketsParam, orderRefsParam]
  );
};

/**
 * Saves sync history to the database
 * @param provider Provider that was synced
 * @param status Status of the sync
 * @param client Optional PoolClient for transactions
 * @returns Promise<void>
 */
export const saveTicketSyncHistory = async (
  provider: TicketProvider,
  status: TicketSyncHistoryStatus,
  client?: PoolClient
) => {
  if (!process.env.TICKETING_PROVIDER) {
    return;
  }
  const db = client || pool;
  await db.query(
    `
    INSERT INTO ticket_sync_history ("provider", "status")
    VALUES ($1, $2)
    `,
    [provider, status]
  );
};

/**
 * Fetches all tickets for a UserId
 * @param userId The UserId for which to fetch tickets
 * @returns A list of Tickets for that UserId
 */
export const getTicketsForUser = async (userId: UserId): Promise<Ticket[]> => {
  if (!process.env.TICKETING_PROVIDER) {
    return [];
  }
  const res = await pool.query(
    `
    SELECT ticket, "orderRef"
    FROM account_ticket 
    JOIN account ON account_ticket."accountId" = account."accountId"
    WHERE account."userId" = $1
    `,
    [userId]
  );
  return res.rows.map((row) => ({ ...ticketFromString(row.ticket), orderRef: row.orderRef }));
};
