/**
 * Ticketing integration library
 * @since 2026-11-26
 * @author Michael Townsend <@continuities>
 */

'use server';

import { inTransaction } from '@/db';
import { getOrders, getOrganiser, getOrganisers } from '@/service/pretix-service';
import { addTickets, saveTicketSyncHistory } from '@/service/ticketing-service';

/**
 * Fetches all purchased tickets from the ticketing provider
 * and updates the database with the most recent data.
 */
export const syncTickets = async () => {
  if (process.env.TICKETING_PROVIDER !== 'pretix') {
    return;
  }
  const provider = process.env.TICKETING_PROVIDER;
  const systemOrganiser = process.env.PRETIX_ORGANISER;
  try {
    const organisersData = systemOrganiser
      ? [await getOrganiser(systemOrganiser)]
      : await getOrganisers();
    const orders = (
      await Promise.all(
        organisersData.map(async (o) =>
          (await getOrders(o.slug)).map((or) => ({ organiser: o.slug, order: or }))
        )
      )
    ).flat();

    const accountTickets = orders
      .filter((o) => o.order.status === 'p')
      .reduce<Record<AccountId, Ticket[]>>((map, { organiser, order }) => {
        if (order.customer) {
          if (!map[order.customer]) {
            map[order.customer] = [];
          }
          map[order.customer].push(
            ...order.positions.map<Ticket>((p) => ({
              provider: 'pretix',
              organiser,
              event: order.event,
              id: p.item
            }))
          );
        }
        return map;
      }, {});
    await inTransaction(async (client) => {
      await addTickets(accountTickets, client);
      await saveTicketSyncHistory(provider, 'success', client);
    });
  } catch (e) {
    console.error('Failed to sync tickets', e);
    // We could save the failure to the sync history table here.
    // For now, skipping it until it becomes important.
  }
};

/**
 * Syncs purchased tickets for a single user to the database
 * @param user The id of the user for which to update ticketing data
 */
export const syncTicketsForUser = async (user: UserId) => {
  // TODO
};
