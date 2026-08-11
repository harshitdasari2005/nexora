/**
 * @nexora/design-system — EmptyState.
 *
 * The friendly empty-state pattern (DESIGN_SYSTEM.md §10 empty states): an
 * icon, title, description, and optional action — used throughout the v1
 * dashboard (installed apps, recent activity).
 */

import type { ReactNode } from 'react';
import { spacing, typography } from '../tokens.js';
import { Stack } from './Stack.js';

/** Props of {@link EmptyState}. */
export interface EmptyStateProps {
  /** A small visual (emoji or inline SVG) above the title. */
  icon?: ReactNode;
  /** The title. */
  title: string;
  /** A short description. */
  description?: string;
  /** Optional action element (e.g. a Button). */
  action?: ReactNode;
}

/** Renders an empty-state panel. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <Stack gap={3} align="center" style={{ textAlign: 'center', padding: spacing[10] }}>
      {icon !== undefined ? (
        <span
          aria-hidden
          style={{
            fontSize: '28px',
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: '16px',
            background: 'var(--nexora-surfaceMuted)',
          }}
        >
          {icon}
        </span>
      ) : null}
      <Stack gap={1}>
        <h3 style={{ fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }}>
          {title}
        </h3>
        {description !== undefined ? (
          <p
            style={{
              fontSize: typography.sizes.sm,
              color: 'var(--nexora-textSecondary)',
              maxWidth: 380,
            }}
          >
            {description}
          </p>
        ) : null}
      </Stack>
      {action !== undefined ? <div>{action}</div> : null}
    </Stack>
  );
}
