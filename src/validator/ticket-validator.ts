/**
 * Form Validators for Tickets
 * @since 2025-11-26
 * @author Michael Townsend <@continuities>
 */

import { deduplicateBy } from '@/utils/list';

/**
 * Validates FormData for ticket strings.
 * @param data - FormData to validate
 * @param fieldName - Optional field name for ticket string (defaults to 'tickets')
 * @returns - Array of validated ticket strings
 * @throws - Error if validation fails
 */
export const validateTicketStrings = (data: FormData, fieldName?: string): TicketString[] => {
  const tickets = data
    .getAll(fieldName ?? 'tickets')
    .map((s) => s.toString().trim())
    .filter(Boolean);
  return deduplicateBy(tickets, (s) => s);
};
