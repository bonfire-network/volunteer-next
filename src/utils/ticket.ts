/**
 * Utilities for working with Tickets
 * @since 2026-11-24
 * @author Michael Townsend <@continuities>
 */

/**
 * Serialises a Ticket
 * @param ticket the Ticket to serialise
 * @returns A unique ticket string
 */
export const ticketToString = (ticket: Ticket): TicketString =>
  `${ticket.provider}/${ticket.organiser}/${ticket.event}/${ticket.id}`;

/**
 * Deserialises a Ticket from a string
 * @param s The string to deserialise
 * @returns A Ticket
 * @throws Error if the ticket string is malformed
 */
export const ticketFromString = (s: TicketString): Ticket => {
  const parts = s.split('/');
  if (parts.length !== 4) {
    throw new Error(`Invalid ticket string: ${s}`);
  }
  const [provider, organiser, event, idString] = parts;
  const id = Number(idString);
  if (isNaN(id)) {
    throw new Error(`Invalid ticket id in ticket string: ${s}`);
  }
  if (provider !== 'pretix') {
    throw new Error(`Invalid ticket provider in ticket string: ${s}`);
  }
  return {
    provider,
    organiser,
    event,
    id
  };
};
