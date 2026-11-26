/**
 * Dialog for selecting a ticket from an external ticketing provider
 * @since 2026-11-24
 * @author Michael Townsend <@continuities>
 */

'use client';

import FormDialog, { FormField } from '@/ui/form-dialog';
import { Link2Icon } from '@radix-ui/react-icons';
import { Button, Dialog, Flex, Select } from '@radix-ui/themes';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

interface Props {
  ticketingContext: TicketingContext;
  onClose?: () => void;
  onSelect?: (ticket: Ticket) => void;
}

export default function TicketPicker({ onClose, onSelect, ticketingContext }: Props) {
  const t = useTranslations('TicketPicker');
  const locale = useLocale();
  const organiserKeys = Object.keys(ticketingContext.organisers);
  const hasMultipleOrganisers = organiserKeys.length > 1;

  const [open, setOpen] = useState(false);
  const [selectedOrganiser, setSelectedOrganiser] = useState<TicketOrganiser | undefined>(
    !hasMultipleOrganisers ? organiserKeys[0] : undefined
  );

  const eventKeys = selectedOrganiser
    ? Object.keys(ticketingContext.organisers[selectedOrganiser]?.events ?? {})
    : [];
  const hasMultipleEvents = eventKeys.length > 1;
  const [selectedEvent, setSelectedEvent] = useState<TicketEvent | undefined>(
    !hasMultipleEvents ? eventKeys[0] : undefined
  );

  const itemKeys =
    selectedOrganiser && selectedEvent
      ? Object.keys(
          ticketingContext.organisers[selectedOrganiser]?.events[selectedEvent]?.items ?? {}
        )
      : [];
  const hasMultipleItems = itemKeys.length > 1;
  const [selectedItem, setSelectedItem] = useState<TicketId | undefined>(
    !hasMultipleItems ? Number(itemKeys[0]) : undefined
  );

  const canSubmit = selectedOrganiser && selectedEvent && selectedItem;

  useEffect(() => {
    if (eventKeys.length === 0 || hasMultipleEvents) {
      setSelectedEvent(undefined);
    } else {
      setSelectedEvent(eventKeys[0]);
    }
  }, [selectedOrganiser, open]);

  useEffect(() => {
    if (itemKeys.length === 0 || hasMultipleItems) {
      setSelectedItem(undefined);
    } else {
      setSelectedItem(Number(itemKeys[0]));
    }
  }, [selectedEvent, open]);

  return (
    <>
      <Button type="button" style={{ alignSelf: 'start' }} onClick={() => setOpen(true)}>
        <Link2Icon />
        {t('title')}
      </Button>
      <FormDialog
        description={t('title')}
        open={open}
        onClose={() => {
          setOpen(false);
          onClose && onClose();
        }}
      >
        <Flex direction="column" height="100%">
          <Dialog.Title as="h2" mt="4" mb="6">
            {t('title')}
          </Dialog.Title>
          <Flex direction="column" gap="4" flexGrow="1">
            {hasMultipleOrganisers && (
              <FormField name={t('organiser')} ariaId="ticketing-organiser-label">
                <Select.Root
                  required
                  name="ticketingOrganiser"
                  defaultValue={selectedOrganiser}
                  disabled={!hasMultipleOrganisers}
                  onValueChange={setSelectedOrganiser}
                >
                  <Select.Trigger
                    aria-labelledby="ticketing-organiser-label"
                    placeholder={t('organiser')}
                  />
                  <Select.Content>
                    {organiserKeys.map((organiserKey) => (
                      <Select.Item key={organiserKey} value={organiserKey}>
                        {ticketingContext.organisers[organiserKey].name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </FormField>
            )}
            <FormField name={t('event')} ariaId="ticketing-event-label">
              <Select.Root
                required
                name="ticketingEvent"
                disabled={!hasMultipleEvents}
                value={selectedEvent ?? ''}
                onValueChange={setSelectedEvent}
              >
                <Select.Trigger aria-labelledby="ticketing-event-label" placeholder={t('event')} />
                <Select.Content>
                  {eventKeys.map((eventKey) => (
                    <Select.Item key={eventKey} value={eventKey}>
                      {
                        ticketingContext.organisers[selectedOrganiser!].events[eventKey].name[
                          locale
                        ]
                      }
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </FormField>
            <FormField name={t('item')} ariaId="ticketing-item-label">
              <Select.Root
                required
                name="ticketingItem"
                disabled={!hasMultipleItems}
                value={String(selectedItem ?? '')}
                onValueChange={(value) => setSelectedItem(Number(value))}
              >
                <Select.Trigger aria-labelledby="ticketing-item-label" placeholder={t('item')} />
                <Select.Content>
                  {itemKeys.map((itemKey) => (
                    <Select.Item key={itemKey} value={itemKey}>
                      {
                        ticketingContext.organisers[selectedOrganiser!].events[selectedEvent!]
                          .items[itemKey][locale]
                      }
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </FormField>
            <Flex gap="4" mt="auto" py="4">
              <Dialog.Close>
                <Button color="gray" variant="soft">
                  {t('cancel')}
                </Button>
              </Dialog.Close>
              <Button
                variant="soft"
                type={'button'}
                disabled={!canSubmit}
                onClick={
                  onSelect && canSubmit
                    ? () => {
                        onSelect({
                          provider: ticketingContext.provider,
                          organiser: selectedOrganiser,
                          event: selectedEvent,
                          id: selectedItem
                        });
                        setOpen(false);
                      }
                    : undefined
                }
              >
                {t('save')}
              </Button>
            </Flex>
          </Flex>
        </Flex>
      </FormDialog>
    </>
  );
}
