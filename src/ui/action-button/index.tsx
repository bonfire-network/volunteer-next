/**
 * Button that calls a server action with a loading state
 * @since 2026-11-27
 * @author Michael Townsend <@continuities>
 */

'use client';

import { Button } from '@radix-ui/themes';
import { useTransition } from 'react';
import type { ComponentProps } from 'react';

type ButtonProps = Omit<ComponentProps<typeof Button>, 'type' | 'loading' | 'onClick'>;

interface Props extends ButtonProps {
  action: () => Promise<unknown>;
}

export default function ActionButton({ action, children, ...buttonProps }: Props) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      {...buttonProps}
      type="button"
      loading={isPending}
      onClick={() => {
        startTransition(async () => {
          await action();
        });
      }}
    >
      {children}
    </Button>
  );
}
