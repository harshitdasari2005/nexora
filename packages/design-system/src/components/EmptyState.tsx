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
    <Stack
      gap={3}
      align="center"
      style={{ textAlign: 'center', padding: `${spacing[10]} ${spacing[6]}` }}
    >
      {icon !== undefined ? (
        <span
          aria-hidden
          style={{
            fontSize: '18px',
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: '10px',
            background: 'var(--nexora-surfaceMuted)',
            border: '1px solid var(--nexora-border)',
            color: 'var(--nexora-textMuted)',
          }}
        >
          {icon}
        </span>
      ) : null}
      <Stack gap={1.5}>
        <h3
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.semibold,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h3>
        {description !== undefined ? (
          <p
            style={{
              fontSize: typography.sizes.sm,
              color: 'var(--nexora-textMuted)',
              maxWidth: 360,
              lineHeight: typography.lineHeights.snug,
            }}
          >
            {description}
          </p>
        ) : null}
      </Stack>
      {action !== undefined ? <div style={{ marginTop: spacing[1] }}>{action}</div> : null}
    </Stack>
  );
}
