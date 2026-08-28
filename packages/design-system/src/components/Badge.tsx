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
  /**
   * Optional style override, merged over the tone's colors — for callers
   * that need a caller-specific accent (e.g. a role's theme color) instead
   * of a fixed semantic tone. Leaves every existing call site unaffected.
   */
  style?: CSSProperties;
  /** Overrides the dot's color independent of `tone` (see `style`). */
  dotColor?: string;
}

const toneStyles: Record<BadgeTone, CSSProperties> = {
  neutral: {
    color: 'var(--nexora-textSecondary)',
    background: 'transparent',
    border: '1px solid var(--nexora-border)',
  },
  primary: {
    color: 'var(--nexora-text)',
    background: 'var(--nexora-surfaceMuted)',
    border: '1px solid var(--nexora-border)',
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
export function Badge({
  tone = 'neutral',
  dot = false,
  children,
  style,
  dotColor,
}: BadgeProps): JSX.Element {
  return (
    <span
      style={{
        ...toneStyles[tone],
        display: 'inline-flex',
        alignItems: 'center',
        gap: spacing[1.5],
        paddingInline: spacing[2],
        height: 20,
        borderRadius: radius.sm,
        fontSize: typography.sizes.xs,
        fontWeight: typography.weights.medium,
        letterSpacing: '-0.003em',
        whiteSpace: 'nowrap',
        lineHeight: 1,
        ...style,
      }}
    >
      {dot ? (
        <span
          aria-hidden
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: dotColor ?? dotColors[tone],
            flexShrink: 0,
          }}
        />
      ) : null}
      {children}
    </span>
  );
}
