/**
 * Service for managing tickets and ticket requirements in the database
 * @since 2026-11-26
 * @author Michael Townsend <@continuities>
 */

import pool from '@/db';
import { ticketFromString } from '@/utils/ticket';
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
