/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import type { ComponentProps, FormEvent } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Theme } from '@radix-ui/themes';
import { ticketToString } from '@/utils/ticket';
import TicketList from '.';

// --- Mocks -----------------------------------------------------------------

let mockLocale = 'en';

jest.mock('next-intl', () => ({
  useLocale: () => mockLocale,
  // Only the remove button's label is translated. It takes the ticket's name so that
  // buttons can be told apart by screen readers: "Disconnect Volunteer ticket".
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    key === 'disconnect' ? `Disconnect ${values?.ticketName}` : key
}));

// The real implementation has its own tests. A simple deterministic stand-in keeps
// these tests focused on how the list uses the string (as the React key and as the
// checkbox value).
jest.mock('@/utils/ticket', () => ({
  ticketToString: (ticket: any) =>
    `${ticket.provider}:${ticket.organiser}:${ticket.event}:${ticket.id}`
}));

// --- Fixtures ----------------------------------------------------------------
// Shape inferred from how the component reads the context:
//   organisers[key].events[key].name[locale] / .items[id][locale]
// Cast through unknown so the tests don't depend on the exact TicketingContext type.

const ticketingContext = {
  provider: 'pretix',
  organisers: {
    'org-a': {
      name: 'Org A',
      events: {
        'festival-2026': {
          name: { en: 'Festival 2026', fr: 'Festival 2026 (FR)' },
          items: {
            '11': { en: 'Volunteer ticket', fr: 'Billet bénévole' },
            '12': { en: 'Day pass', fr: 'Pass journée' }
          }
        },
        workshop: {
          name: { en: 'Workshop', fr: 'Atelier' },
          items: { '21': { en: 'Workshop ticket', fr: 'Billet atelier' } }
        }
      }
    },
    'org-b': {
      name: 'Org B',
      events: {
        meetup: {
          name: { en: 'Meetup', fr: 'Rencontre' },
          items: { '31': { en: 'Meetup ticket', fr: 'Billet rencontre' } }
        }
      }
    }
  }
} as unknown as TicketingContext;

const makeTicket = (organiser: string, event: string, id: number): Ticket => ({
  provider: 'pretix',
  organiser,
  event,
  id
});

const volunteer = makeTicket('org-a', 'festival-2026', 11);
const dayPass = makeTicket('org-a', 'festival-2026', 12);
const workshop = makeTicket('org-a', 'workshop', 21);
const meetup = makeTicket('org-b', 'meetup', 31);

// Tickets that point at things the ticketing context doesn't know about, e.g. because
// they were deleted or deactivated in Pretix after the ticket was linked.
const unknownOrganiser = makeTicket('org-x', 'festival-2026', 11);
const unknownEvent = makeTicket('org-a', 'gone-event', 11);
const unknownItem = makeTicket('org-a', 'festival-2026', 999);

// --- Helpers -----------------------------------------------------------------

const onSubmit = jest.fn((event: FormEvent) => event.preventDefault());

type Props = ComponentProps<typeof TicketList>;

/** Always renders inside a form, since the component's job is to contribute form values. */
const ui = (props: Partial<Props> = {}) => (
  <Theme>
    <form data-testid="form" onSubmit={onSubmit}>
      <TicketList tickets={[]} ticketingContext={ticketingContext} {...props} />
    </form>
  </Theme>
);

const getForm = () => screen.getByTestId('form') as HTMLFormElement;

// --- Tests ---------------------------------------------------------------------

beforeEach(() => {
  mockLocale = 'en';
  onSubmit.mockClear();
});

describe('TicketList', () => {
  describe('rendering', () => {
    it('shows the event name and ticket name of a ticket', () => {
      render(ui({ tickets: [volunteer] }));
      expect(screen.getByText('Festival 2026')).toBeInTheDocument();
      expect(screen.getByText('Volunteer ticket')).toBeInTheDocument();
    });

    it('shows a card for every ticket, in the order given, across organisers and events', () => {
      render(ui({ tickets: [meetup, volunteer, workshop] }));
      const ticketNames = screen.getAllByText(/ticket/).map((el) => el.textContent);
      expect(ticketNames).toEqual(['Meetup ticket', 'Volunteer ticket', 'Workshop ticket']);
      expect(screen.getByText('Meetup')).toBeInTheDocument();
      expect(screen.getByText('Festival 2026')).toBeInTheDocument();
      expect(screen.getByText('Workshop')).toBeInTheDocument();
    });

    it('shows each ticket’s own name when several tickets belong to the same event', () => {
      render(ui({ tickets: [volunteer, dayPass] }));
      expect(screen.getAllByText('Festival 2026')).toHaveLength(2);
      expect(screen.getByText('Volunteer ticket')).toBeInTheDocument();
      expect(screen.getByText('Day pass')).toBeInTheDocument();
    });

    it('uses the current locale for event and ticket names', () => {
      mockLocale = 'fr';
      render(ui({ tickets: [volunteer] }));
      expect(screen.getByText('Festival 2026 (FR)')).toBeInTheDocument();
      expect(screen.getByText('Billet bénévole')).toBeInTheDocument();
      expect(screen.queryByText('Volunteer ticket')).not.toBeInTheDocument();
    });

    it('renders nothing visible when there are no tickets', () => {
      const { container } = render(ui({ tickets: [] }));
      expect(container.textContent).toBe('');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(container.querySelector('input')).not.toBeInTheDocument();
    });

    describe('tickets missing from the ticketing context', () => {
      it('falls back to the raw event slug and ticket id when the organiser is unknown', () => {
        render(ui({ tickets: [unknownOrganiser] }));
        expect(screen.getByText('festival-2026')).toBeInTheDocument();
        expect(screen.getByText('11')).toBeInTheDocument();
      });

      it('falls back to the raw event slug and ticket id when the event is unknown', () => {
        render(ui({ tickets: [unknownEvent] }));
        expect(screen.getByText('gone-event')).toBeInTheDocument();
        expect(screen.getByText('11')).toBeInTheDocument();
      });

      it('keeps the event name and falls back to the ticket id when only the ticket is unknown', () => {
        render(ui({ tickets: [unknownItem] }));
        expect(screen.getByText('Festival 2026')).toBeInTheDocument();
        expect(screen.getByText('999')).toBeInTheDocument();
      });

      it('still renders the other tickets in the list', () => {
        render(ui({ tickets: [volunteer, unknownEvent, workshop] }));
        expect(screen.getByText('Volunteer ticket')).toBeInTheDocument();
        expect(screen.getByText('gone-event')).toBeInTheDocument();
        expect(screen.getByText('Workshop ticket')).toBeInTheDocument();
      });

      it('still submits the unresolved ticket, so saving the form does not silently drop it', () => {
        render(ui({ tickets: [volunteer, unknownEvent], name: 'tickets' }));
        expect(new FormData(getForm()).getAll('tickets')).toEqual([
          ticketToString(volunteer),
          ticketToString(unknownEvent)
        ]);
      });

      it('still lets the user remove the unresolved ticket', async () => {
        const user = userEvent.setup();
        const onRemove = jest.fn();
        render(ui({ tickets: [unknownEvent], onRemove }));

        await user.click(screen.getByRole('button'));

        expect(onRemove).toHaveBeenCalledWith(unknownEvent);
      });
    });
  });

  describe('form values (name prop)', () => {
    it('adds no inputs when name is not given', () => {
      const { container } = render(ui({ tickets: [volunteer, dayPass] }));
      expect(container.querySelectorAll('input')).toHaveLength(0);
    });

    it('adds one hidden, pre-checked checkbox per ticket when name is given', () => {
      const { container } = render(ui({ tickets: [volunteer, dayPass], name: 'tickets' }));
      const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'));

      expect(inputs).toHaveLength(2);
      inputs.forEach((input) => {
        expect(input).toHaveAttribute('type', 'checkbox');
        expect(input).toHaveAttribute('name', 'tickets');
        expect(input).toHaveAttribute('hidden');
        expect(input).toBeChecked();
      });
      expect(inputs.map((input) => input.value)).toEqual([
        ticketToString(volunteer),
        ticketToString(dayPass)
      ]);
    });

    it('submits every ticket under the given name', () => {
      render(ui({ tickets: [volunteer, meetup], name: 'tickets' }));
      expect(new FormData(getForm()).getAll('tickets')).toEqual([
        ticketToString(volunteer),
        ticketToString(meetup)
      ]);
    });

    it('uses the given name as the field name', () => {
      render(ui({ tickets: [volunteer], name: 'volunteerTickets' }));
      const data = new FormData(getForm());
      expect(data.getAll('volunteerTickets')).toEqual([ticketToString(volunteer)]);
      expect(data.has('tickets')).toBe(false);
    });

    it('submits nothing for tickets that have been removed from the list', () => {
      const { rerender } = render(ui({ tickets: [volunteer, dayPass], name: 'tickets' }));
      expect(new FormData(getForm()).getAll('tickets')).toHaveLength(2);

      rerender(ui({ tickets: [dayPass], name: 'tickets' }));

      expect(new FormData(getForm()).getAll('tickets')).toEqual([ticketToString(dayPass)]);
    });

    it('submits newly added tickets', () => {
      const { rerender } = render(ui({ tickets: [volunteer], name: 'tickets' }));

      rerender(ui({ tickets: [volunteer, workshop], name: 'tickets' }));

      expect(new FormData(getForm()).getAll('tickets')).toEqual([
        ticketToString(volunteer),
        ticketToString(workshop)
      ]);
    });
  });

  describe('removing tickets (onRemove prop)', () => {
    it('shows no remove buttons when onRemove is not given', () => {
      render(ui({ tickets: [volunteer, dayPass] }));
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows one remove button per ticket when onRemove is given', () => {
      render(ui({ tickets: [volunteer, dayPass, workshop], onRemove: jest.fn() }));
      expect(screen.getAllByRole('button')).toHaveLength(3);
    });

    it('calls onRemove with the ticket whose button was clicked', async () => {
      const user = userEvent.setup();
      const onRemove = jest.fn();
      render(ui({ tickets: [volunteer, dayPass, workshop], onRemove }));

      await user.click(screen.getAllByRole('button')[1]);

      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledWith(dayPass);
    });

    it('does not submit the enclosing form when a remove button is clicked', async () => {
      const user = userEvent.setup();
      render(ui({ tickets: [volunteer], onRemove: jest.fn() }));

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('type', 'button');
      await user.click(button);

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('does not change the list itself; removal is up to the parent', async () => {
      const user = userEvent.setup();
      render(ui({ tickets: [volunteer], onRemove: jest.fn() }));

      await user.click(screen.getByRole('button'));

      expect(screen.getByText('Volunteer ticket')).toBeInTheDocument();
    });

    describe('accessible names', () => {
      it('labels each remove button with the name of its ticket', () => {
        render(ui({ tickets: [volunteer, dayPass], onRemove: jest.fn() }));
        expect(
          screen.getByRole('button', { name: 'Disconnect Volunteer ticket' })
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Disconnect Day pass' })).toBeInTheDocument();
      });

      it('uses the ticket name in the current locale', () => {
        mockLocale = 'fr';
        render(ui({ tickets: [volunteer], onRemove: jest.fn() }));
        expect(
          screen.getByRole('button', { name: 'Disconnect Billet bénévole' })
        ).toBeInTheDocument();
      });

      it('puts the label on the button that removes that ticket', async () => {
        const user = userEvent.setup();
        const onRemove = jest.fn();
        render(ui({ tickets: [volunteer, dayPass, workshop], onRemove }));

        await user.click(screen.getByRole('button', { name: 'Disconnect Day pass' }));

        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove).toHaveBeenCalledWith(dayPass);
      });
    });
  });
});
