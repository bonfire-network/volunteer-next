/**
 * Ticketing integration library
 * @since 2026-11-26
 * @author Michael Townsend <@continuities>
 */

import { inTransaction } from '@/db';
import { getOrders, getOrganiser, getOrganisers } from '@/service/pretix-service';
import { addTickets, removeTickets, saveTicketSyncHistory } from '@/service/ticketing-service';

export const isTicketingEnabled = () => {
  // For now, 'pretix' is the only implemented provider
  return process.env.TICKETING_PROVIDER === 'pretix';
};

/**
 * Fetches all purchased tickets from the ticketing provider
 * and updates the database with the most recent data.
 */
export const syncTickets = async () => {
  if (!isTicketingEnabled()) {
    return;
  }
  const provider = process.env.TICKETING_PROVIDER as TicketProvider;
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

    const accountTickets = orders.reduce<{
      paid: Record<AccountId, OrderedTicket[]>;
      canceled: Record<AccountId, OrderedTicket[]>;
    }>(
      (map, { organiser, order }) => {
        const status =
          order.status === 'p' ? 'paid' : order.status === 'c' ? 'canceled' : undefined;
        if (!order.customer || !status) {
          return map;
        }
        for (const position of order.positions) {
          const positionStatus = status === 'canceled' || position.canceled ? 'canceled' : 'paid';
          if (!map[positionStatus][order.customer]) {
            map[positionStatus][order.customer] = [];
          }
          map[positionStatus][order.customer].push({
            provider: 'pretix',
            organiser,
            event: order.event,
            id: position.item,
            orderRef: `${organiser}/${order.event}/${order.code}`
          });
        }
        return map;
      },
      { paid: {}, canceled: {} }
    );

    await inTransaction(async (client) => {
      await removeTickets(accountTickets.canceled, client);
      await addTickets(accountTickets.paid, client);
      // TODO: Cancel volunteer shifts for any refunded tickets
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
