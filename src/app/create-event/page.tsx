import metadata from '@/i18n/metadata';
import { redirect } from 'next/navigation';
import { Flex, Heading, Card } from '@radix-ui/themes';
import { getTranslations } from 'next-intl/server';
import { createEvent } from '@/service/event-service';
import { addRoleToUsers, getUsers } from '@/service/user-service';
import { checkAuthorisation, currentUser } from '@/session';
import { inTransaction } from '@/db';
import EventForm from '@/ui/event-form';
import { validateNewEvent } from '@/validator/event-validator';
import { validateUserIds } from '@/validator/user-validator';
import { usersToVolunteers } from '@/lib/volunteer';
import { getPermissionsProfile } from '@/utils/permissions';
import { getEventsPath } from '@/utils/path';
import { uploadImageAction } from '@/lib/image';
import { getTicketingContext } from '@/service/pretix-service';
import { validateTicketStrings } from '@/validator/ticket-validator';
import { addTicketRequirementsToEvent } from '@/service/ticketing-service';
import { isTicketingEnabled } from '@/lib/ticketing';

const PAGE_KEY = 'CreateEventPage';

export const generateMetadata = metadata(PAGE_KEY);

export default async function CreateEvent() {
  const onSubmit = async (data: FormData) => {
    'use server';

    await checkAuthorisation([{ type: 'admin' }]);

    const newEvent = validateNewEvent(data);
    const organiser = validateUserIds(data, 'organiserId')[0]; // Only single organiser supported for now
    const ticketRequirements = validateTicketStrings(data);

    await inTransaction(async (client) => {
      const createdEvent = await createEvent(newEvent, client);
      await addRoleToUsers({ type: 'organiser', eventId: createdEvent.id }, [organiser], client);
      await addTicketRequirementsToEvent(createdEvent.id, ticketRequirements, client);
    });
    redirect(getEventsPath());
  };

  await checkAuthorisation([{ type: 'admin' }]);
  const t = await getTranslations(PAGE_KEY);
  const permissionsProfile = getPermissionsProfile(await currentUser());
  const volunteers = usersToVolunteers(await getUsers(), permissionsProfile);

  const ticketingContext: TicketingContext | undefined = isTicketingEnabled()
    ? await getTicketingContext()
    : undefined;

  return (
    <Flex direction="column" gap="4">
      <Heading my="4">{t('title')}</Heading>
      <Card>
        <EventForm
          onUpload={uploadImageAction}
          onSubmit={onSubmit}
          backOnCancel
          organiserOptions={volunteers}
          ticketingContext={ticketingContext}
        />
      </Card>
    </Flex>
  );
}
