/**
 * List of tickets form component
 * @since 2026-11-24
 * @author Michael Townsend <@continuities>
 */

'use client';

import { ticketToString } from '@/utils/ticket';
import { LinkBreak2Icon } from '@radix-ui/react-icons';
import { Card, Flex, IconButton, Text } from '@radix-ui/themes';
import { useLocale, useTranslations } from 'next-intl';

interface Props {
  tickets: Ticket[];
  ticketingContext: TicketingContext;
  name?: string;
  onRemove?: (ticket: Ticket) => void;
}

export default function TicketList({ tickets, ticketingContext, onRemove, name }: Props) {
  const locale = useLocale();
  const t = useTranslations('TicketList');
  return (
    <Flex gap="2" wrap="wrap">
      {tickets.map((ticket) => (
        <Card key={ticketToString(ticket)}>
          {name && (
            <input
              type="checkbox"
              name={name}
              value={ticketToString(ticket)}
              key={ticketToString(ticket)}
              hidden
              defaultChecked
            />
          )}
          <Flex>
            <Flex direction="column" gap="1">
              <Flex direction="column">
                <Text size="1" weight="light" color="gray">
                  {ticketingContext.organisers[ticket.organiser]?.events[ticket.event]?.name[
                    locale
                  ] ?? ticket.event}
                </Text>
              </Flex>
              <Text>
                {(ticketingContext.organisers[ticket.organiser]?.events[ticket.event]?.items[
                  ticket.id
                ] ?? {})[locale] ?? ticket.id}
              </Text>
            </Flex>
            {onRemove && (
              <IconButton
                type="button"
                variant="ghost"
                color="red"
                aria-label={t('disconnect', {
                  ticketName:
                    (ticketingContext.organisers[ticket.organiser]?.events[ticket.event]?.items[
                      ticket.id
                    ] ?? {})[locale] ?? ticket.id
                })}
                onClick={() => onRemove(ticket)}
              >
                <LinkBreak2Icon />
              </IconButton>
            )}
          </Flex>
        </Card>
      ))}
    </Flex>
  );
}
