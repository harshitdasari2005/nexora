/**
 * @nexora/app-web — ErrorState.
 *
 * The standard inline error state (DESIGN_SYSTEM.md §10 error states): a
 * message plus an optional retry action.
 */

import { Button, EmptyState, Stack, typography } from '@nexora/design-system';

import { NavIcon } from './NavIcon.js';

/** Props of {@link ErrorState}. */
export interface ErrorStateProps {
  /** The error title. */
  title?: string;
  /** A detail message. */
  message?: string;
  /** Optional retry handler. */
  onRetry?: () => void;
}

/** Renders an inline error state. */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: ErrorStateProps): JSX.Element {
  return (
    <Stack gap={3} align="center" style={{ padding: 48 }}>
      <EmptyState
        icon={<NavIcon name="problems" size={18} />}
        title={title}
        description={message ?? 'An unexpected error occurred. Please try again in a moment.'}
      />
      {onRetry !== undefined ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
      <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
        Reference this request if you contact support.
      </p>
    </Stack>
  );
}
