/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { Component } from 'react';
import type { ComponentProps, FormEvent, ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Theme } from '@radix-ui/themes';
import ActionButton from '.';

// --- Helpers -----------------------------------------------------------------

type Props = ComponentProps<typeof ActionButton>;

/** A promise that the test resolves or rejects by hand, to hold an action "in flight". */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const renderButton = (props: Partial<Props> = {}) => {
  const user = userEvent.setup();
  const action = (props.action ?? jest.fn().mockResolvedValue(undefined)) as jest.Mock;
  render(
    <Theme>
      <ActionButton action={action} {...props}>
        Sync
      </ActionButton>
    </Theme>
  );
  return { user, action };
};

const getButton = () => screen.getByRole('button', { name: 'Sync' });

/** Minimal error boundary, to observe what happens when an action throws. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children;
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

// --- Tests ---------------------------------------------------------------------

describe('ActionButton', () => {
  describe('rendering', () => {
    it('renders its children inside a button', () => {
      renderButton();
      expect(getButton()).toBeInTheDocument();
    });

    it('renders type="button", so it never submits a surrounding form', () => {
      renderButton();
      expect(getButton()).toHaveAttribute('type', 'button');
    });

    it('is enabled when idle', () => {
      renderButton();
      expect(getButton()).toBeEnabled();
    });

    it('forwards other props to the button', () => {
      renderButton({ 'aria-label': 'Sync shifts', 'data-testid': 'sync' } as Partial<Props>);
      const button = screen.getByRole('button', { name: 'Sync shifts' });
      expect(button).toHaveAttribute('data-testid', 'sync');
    });

    it('ignores a type passed in by the caller', () => {
      renderButton({ type: 'submit' } as unknown as Partial<Props>);
      expect(getButton()).toHaveAttribute('type', 'button');
    });
  });

  describe('running the action', () => {
    it('does not call the action until the button is clicked', () => {
      const { action } = renderButton();
      expect(action).not.toHaveBeenCalled();
    });

    it('calls the action once, with no arguments, per click', async () => {
      const { user, action } = renderButton();

      await user.click(getButton());

      expect(action).toHaveBeenCalledTimes(1);
      expect(action).toHaveBeenCalledWith();
    });

    it('can be clicked again once the action has finished', async () => {
      const { user, action } = renderButton();

      await user.click(getButton());
      await waitFor(() => expect(getButton()).toBeEnabled());
      await user.click(getButton());

      expect(action).toHaveBeenCalledTimes(2);
    });

    it('does not call the action when the button is disabled by the caller', async () => {
      const { user, action } = renderButton({ disabled: true });

      await user.click(getButton());

      expect(action).not.toHaveBeenCalled();
    });

    it('does not submit an enclosing form', async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn((event: FormEvent) => event.preventDefault());
      const action = jest.fn().mockResolvedValue(undefined);
      render(
        <Theme>
          <form onSubmit={onSubmit}>
            <ActionButton action={action}>Sync</ActionButton>
          </form>
        </Theme>
      );

      await user.click(getButton());

      expect(action).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('while the action is running', () => {
    it('shows a loading state, which disables the button, until the action finishes', async () => {
      const { promise, resolve } = deferred();
      const { user } = renderButton({ action: jest.fn(() => promise) });

      await user.click(getButton());

      // While loading, Radix hides the label from the accessibility tree, so find it by role alone
      expect(screen.getByRole('button')).toBeDisabled();

      await act(async () => {
        resolve();
      });

      await waitFor(() => expect(getButton()).toBeEnabled());
    });

    it('ignores further clicks until the action has finished', async () => {
      const { promise, resolve } = deferred();
      const action = jest.fn(() => promise);
      const { user } = renderButton({ action });

      await user.click(getButton());
      await user.click(screen.getByRole('button'));
      await user.click(screen.getByRole('button'));

      expect(action).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolve();
      });
      await waitFor(() => expect(getButton()).toBeEnabled());
    });

    it('does not report itself as finished before the action settles', async () => {
      const { promise, resolve } = deferred();
      const { user } = renderButton({ action: jest.fn(() => promise) });

      await user.click(getButton());
      // Give React a few turns of the event loop; the button must stay disabled
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

      expect(screen.getByRole('button')).toBeDisabled();

      await act(async () => {
        resolve();
      });
      await waitFor(() => expect(getButton()).toBeEnabled());
    });
  });

  describe('when the action fails', () => {
    it('hands a rejected action to the nearest error boundary', async () => {
      // React logs caught errors with console.error
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      const action = jest.fn().mockRejectedValue(new Error('sync failed'));
      render(
        <Theme>
          <Boundary>
            <ActionButton action={action}>Sync</ActionButton>
          </Boundary>
        </Theme>
      );

      await user.click(getButton());

      expect(await screen.findByRole('alert')).toHaveTextContent('sync failed');
    });
  });
});
