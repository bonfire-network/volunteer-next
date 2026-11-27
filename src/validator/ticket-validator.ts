/**
 * Form Validators for Tickets
 * @since 2026-11-26
 * @author Michael Townsend <@continuities>
 */

import { deduplicateBy } from '@/utils/list';
import { ticketFromString } from '@/utils/ticket';

/**
 * Validates FormData for ticket strings.
 * @param data - FormData to validate
 * @param fieldName - Optional field name for ticket string (defaults to 'tickets')
 * @returns - Array of validated ticket strings
 * @throws - Error if validation fails
 */
export const validateTicketStrings = (data: FormData, fieldName?: string): TicketString[] => {
  const tickets = deduplicateBy(
    data
      .getAll(fieldName ?? 'tickets')
      .map((s) => s.toString().trim())
      .filter(Boolean),
    (s) => s
  );
  tickets.forEach(ticketFromString); // Throws if the format is bad
  return tickets;
};
