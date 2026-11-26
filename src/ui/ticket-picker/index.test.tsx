/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Theme } from '@radix-ui/themes';
import TicketPicker from '.';

// --- Mocks -----------------------------------------------------------------

const mockMessages: Record<string, string> = {
  title: 'Link ticket',
  organiser: 'Organiser',
  event: 'Event',
  item: 'Ticket type',
  cancel: 'Cancel',
  save: 'Save'
};
let mockLocale = 'en';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => mockMessages[key] ?? key,
  useLocale: () => mockLocale
}));

// Stand-in for the app's FormDialog/FormField. It keeps a real Radix Dialog around
// the children (so Dialog.Title and Dialog.Close work) and renders the label element
// that the selects reference through aria-labelledby.
jest.mock('@/ui/form-dialog', () => {
  const React = require('react');
  const { Dialog } = require('@radix-ui/themes');
  return {
    __esModule: true,
    default: ({ open, onClose, children }: any) =>
      React.createElement(
        Dialog.Root,
        {
          open,
          onOpenChange: (next: boolean) => {
            if (!next) {
              onClose?.();
            }
          }
        },
        React.createElement(Dialog.Content, { 'aria-describedby': undefined }, children)
      ),
    FormField: ({ name, ariaId, children }: any) =>
      React.createElement('div', null, React.createElement('span', { id: ariaId }, name), children)
  };
});

// jsdom lacks several browser APIs that Radix Select / ScrollArea rely on.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.HTMLElement.prototype.hasPointerCapture = jest.fn();
  window.HTMLElement.prototype.setPointerCapture = jest.fn();
  window.HTMLElement.prototype.releasePointerCapture = jest.fn();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  mockLocale = 'en';
});

// --- Fixtures ----------------------------------------------------------------
// Shape inferred from how the component reads the context:
//   organisers[key].name / .events[key].name[locale] / .events[key].items[id][locale]
// Cast through unknown so the tests don't depend on the exact TicketingContext type.

const orgA = {
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
};

const orgB = {
  name: 'Org B',
  events: {
    meetup: {
      name: { en: 'Meetup', fr: 'Rencontre' },
      items: { '31': { en: 'Meetup ticket', fr: 'Billet rencontre' } }
    }
  }
};

/** One organiser, one event, one ticket type: everything can be preselected. */
const singleContext = {
  provider: 'pretix',
  organisers: {
    'org-a': {
      name: 'Org A',
      events: {
        'festival-2026': {
          name: { en: 'Festival 2026', fr: 'Festival 2026 (FR)' },
          items: { '11': { en: 'Volunteer ticket', fr: 'Billet bénévole' } }
        }
      }
    }
  }
} as unknown as TicketingContext;

/** Two organisers; org-a has several events, org-b has exactly one event and ticket. */
const multiContext = {
  provider: 'pretix',
  organisers: { 'org-a': orgA, 'org-b': orgB }
} as unknown as TicketingContext;

/** One organiser with several events. */
const singleOrganiserMultiEventContext = {
  provider: 'pretix',
  organisers: { 'org-a': orgA }
} as unknown as TicketingContext;

// --- Helpers -----------------------------------------------------------------

type User = ReturnType<typeof userEvent.setup>;

const renderPicker = (ticketingContext: TicketingContext) => {
  // Radix sets pointer-events: none on the body while a dialog/select is open.
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const onSelect = jest.fn();
  const onClose = jest.fn();
  render(
    <Theme>
      <TicketPicker ticketingContext={ticketingContext} onSelect={onSelect} onClose={onClose} />
    </Theme>
  );
  return { user, onSelect, onClose };
};

const openDialog = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Link ticket' }));
  await screen.findByRole('dialog');
};

const combobox = (label: string) => screen.getByRole('combobox', { name: label });
const saveButton = () => screen.getByRole('button', { name: 'Save' });

const choose = async (user: User, selectLabel: string, optionLabel: string) => {
  await user.click(combobox(selectLabel));
  await user.click(await screen.findByRole('option', { name: optionLabel }));
};

const optionLabels = async (user: User, selectLabel: string) => {
  await user.click(combobox(selectLabel));
  const options = await screen.findAllByRole('option');
  return options.map((option) => option.textContent);
};

// --- Tests ---------------------------------------------------------------------

describe('TicketPicker', () => {
  describe('trigger and dialog', () => {
    it('shows only the trigger button until it is clicked', () => {
      renderPicker(singleContext);
      expect(screen.getByRole('button', { name: 'Link ticket' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens the dialog with a title when the trigger is clicked', async () => {
      const { user } = renderPicker(singleContext);
      await openDialog(user);
      expect(screen.getByRole('heading', { level: 2, name: 'Link ticket' })).toBeInTheDocument();
    });

    it('calls onClose and closes the dialog when Cancel is clicked', async () => {
      const { user, onClose, onSelect } = renderPicker(singleContext);
      await openDialog(user);

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('calls onClose when the dialog is dismissed with Escape', async () => {
      const { user, onClose } = renderPicker(singleContext);
      await openDialog(user);

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
  });

  describe('with one organiser, one event and one ticket type', () => {
    it('does not show the organiser select', async () => {
      const { user } = renderPicker(singleContext);
      await openDialog(user);
      expect(screen.queryByRole('combobox', { name: 'Organiser' })).not.toBeInTheDocument();
    });

    it('shows the only event and ticket type preselected and disabled', async () => {
      const { user } = renderPicker(singleContext);
      await openDialog(user);

      expect(combobox('Event')).toBeDisabled();
      expect(combobox('Event')).toHaveTextContent('Festival 2026');
      expect(combobox('Ticket type')).toBeDisabled();
      expect(combobox('Ticket type')).toHaveTextContent('Volunteer ticket');
    });

    it('enables Save straight away', async () => {
      const { user } = renderPicker(singleContext);
      await openDialog(user);
      expect(saveButton()).toBeEnabled();
    });

    it('reports the preselected ticket through onSelect and closes the dialog', async () => {
      const { user, onSelect } = renderPicker(singleContext);
      await openDialog(user);

      await user.click(saveButton());

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith({
        provider: 'pretix',
        organiser: 'org-a',
        event: 'festival-2026',
        id: 11
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('shows event and ticket names in the current locale', async () => {
      mockLocale = 'fr';
      const { user } = renderPicker(singleContext);
      await openDialog(user);

      expect(combobox('Event')).toHaveTextContent('Festival 2026 (FR)');
      expect(combobox('Ticket type')).toHaveTextContent('Billet bénévole');
    });
  });

  describe('with several organisers (initial state)', () => {
    it('shows an enabled organiser select with every organiser as an option', async () => {
      const { user } = renderPicker(multiContext);
      await openDialog(user);

      expect(combobox('Organiser')).toBeEnabled();
      const labels = await optionLabels(user, 'Organiser');
      expect(labels).toEqual(['Org A', 'Org B']);
    });

    it('keeps the event and ticket selects disabled and Save disabled until an organiser is chosen', async () => {
      const { user } = renderPicker(multiContext);
      await openDialog(user);

      expect(combobox('Event')).toBeDisabled();
      expect(combobox('Ticket type')).toBeDisabled();
      expect(saveButton()).toBeDisabled();
    });
  });

  // ---------------------------------------------------------------------------
  // The tests below describe the intended behaviour when there is more than one
  // choice at some level. They are expected to FAIL against the component as it
  // stands (see the notes that came with this file): it throws when an event hasn't
  // been selected yet, and it never updates its preselected values after the
  // initial render.
  // ---------------------------------------------------------------------------
  describe('choosing among several organisers, events and ticket types', () => {
    it('enables the event select with that organiser’s events once an organiser is chosen', async () => {
      const { user } = renderPicker(multiContext);
      await openDialog(user);

      await choose(user, 'Organiser', 'Org A');

      expect(combobox('Event')).toBeEnabled();
      expect(await optionLabels(user, 'Event')).toEqual(['Festival 2026', 'Workshop']);
    });

    it('lists the ticket types of the chosen event and keeps Save disabled until one is picked', async () => {
      const { user } = renderPicker(multiContext);
      await openDialog(user);

      await choose(user, 'Organiser', 'Org A');
      await choose(user, 'Event', 'Festival 2026');

      expect(combobox('Ticket type')).toBeEnabled();
      expect(saveButton()).toBeDisabled();
      expect(await optionLabels(user, 'Ticket type')).toEqual(['Volunteer ticket', 'Day pass']);
    });

    it('submits the ticket that was chosen step by step', async () => {
      const { user, onSelect } = renderPicker(multiContext);
      await openDialog(user);

      await choose(user, 'Organiser', 'Org A');
      await choose(user, 'Event', 'Festival 2026');
      await choose(user, 'Ticket type', 'Day pass');
      expect(saveButton()).toBeEnabled();
      await user.click(saveButton());

      expect(onSelect).toHaveBeenCalledWith({
        provider: 'pretix',
        organiser: 'org-a',
        event: 'festival-2026',
        id: 12
      });
    });

    it('preselects the only event and ticket type of an organiser', async () => {
      const { user, onSelect } = renderPicker(multiContext);
      await openDialog(user);

      await choose(user, 'Organiser', 'Org B');

      expect(combobox('Event')).toHaveTextContent('Meetup');
      expect(combobox('Ticket type')).toHaveTextContent('Meetup ticket');
      expect(saveButton()).toBeEnabled();
      await user.click(saveButton());
      expect(onSelect).toHaveBeenCalledWith({
        provider: 'pretix',
        organiser: 'org-b',
        event: 'meetup',
        id: 31
      });
    });

    it('preselects the only ticket type of an event', async () => {
      const { user, onSelect } = renderPicker(multiContext);
      await openDialog(user);

      await choose(user, 'Organiser', 'Org A');
      await choose(user, 'Event', 'Workshop');

      expect(combobox('Ticket type')).toHaveTextContent('Workshop ticket');
      await user.click(saveButton());
      expect(onSelect).toHaveBeenCalledWith({
        provider: 'pretix',
        organiser: 'org-a',
        event: 'workshop',
        id: 21
      });
    });

    it('does not carry an earlier event or ticket over when the organiser changes', async () => {
      const { user, onSelect } = renderPicker(multiContext);
      await openDialog(user);

      await choose(user, 'Organiser', 'Org A');
      await choose(user, 'Event', 'Festival 2026');
      await choose(user, 'Ticket type', 'Day pass');
      await choose(user, 'Organiser', 'Org B');
      await user.click(saveButton());

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith({
        provider: 'pretix',
        organiser: 'org-b',
        event: 'meetup',
        id: 31
      });
    });

    it('with one organiser and several events, skips the organiser select and lets the user pick an event', async () => {
      const { user, onSelect } = renderPicker(singleOrganiserMultiEventContext);
      await openDialog(user);

      expect(screen.queryByRole('combobox', { name: 'Organiser' })).not.toBeInTheDocument();
      expect(combobox('Event')).toBeEnabled();
      expect(saveButton()).toBeDisabled();

      await choose(user, 'Event', 'Festival 2026');
      await choose(user, 'Ticket type', 'Volunteer ticket');
      await user.click(saveButton());

      expect(onSelect).toHaveBeenCalledWith({
        provider: 'pretix',
        organiser: 'org-a',
        event: 'festival-2026',
        id: 11
      });
    });
  });
});
