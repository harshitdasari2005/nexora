/**
 * @nexora/design-system — Badge.
 *
 * Compact status/context labels (DESIGN_SYSTEM.md §8, status colors §3.6).
 */

import type { CSSProperties, ReactNode } from 'react';
import { radius, spacing, typography } from '../tokens.js';

/** Tones of {@link Badge}. */
export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'ai';

/** Props of {@link Badge}. */
export interface BadgeProps {
  /** The tone (default `neutral`). */
  tone?: BadgeTone;
  /** Shows a leading status dot. */
  dot?: boolean;
  /** Children. */
  children: ReactNode;
}

const toneStyles: Record<BadgeTone, CSSProperties> = {
  neutral: {
    color: 'var(--nexora-textSecondary)',
    background: 'var(--nexora-surfaceMuted)',
    border: '1px solid var(--nexora-border)',
  },
  primary: {
    color: 'var(--nexora-primary)',
    background: 'var(--nexora-primarySoft)',
    border: '1px solid transparent',
  },
  success: {
    color: 'var(--nexora-success)',
    background: 'var(--nexora-successSoft)',
    border: '1px solid transparent',
  },
  warning: {
    color: 'var(--nexora-warning)',
    background: 'var(--nexora-warningSoft)',
    border: '1px solid transparent',
  },
  danger: {
    color: 'var(--nexora-danger)',
    background: 'var(--nexora-dangerSoft)',
    border: '1px solid transparent',
  },
  ai: {
    color: 'var(--nexora-ai)',
    background: 'var(--nexora-aiSoft)',
    border: '1px solid transparent',
  },
};

const dotColors: Record<BadgeTone, string> = {
  neutral: 'var(--nexora-textMuted)',
  primary: 'var(--nexora-primary)',
  success: 'var(--nexora-success)',
  warning: 'var(--nexora-warning)',
  danger: 'var(--nexora-danger)',
  ai: 'var(--nexora-ai)',
};

/** Renders a status badge. */
export function Badge({ tone = 'neutral', dot = false, children }: BadgeProps): JSX.Element {
  return (
    <span
      style={{
        ...toneStyles[tone],
        display: 'inline-flex',
        alignItems: 'center',
        gap: spacing[1.5],
        paddingInline: spacing[2.5],
        height: 22,
        borderRadius: radius.full,
        fontSize: typography.sizes.xs,
        fontWeight: typography.weights.medium,
        whiteSpace: 'nowrap',
      }}
    >
      {dot ? (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: dotColors[tone],
          }}
        />
      ) : null}
      {children}
    </span>
  );
}
