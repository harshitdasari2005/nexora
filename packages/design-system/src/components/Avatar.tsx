/**
 * @nexora/design-system — Avatar.
 *
 * An initials avatar (DESIGN_SYSTEM.md §8 identity components). Monochrome
 * by design — a neutral chip with a hairline ring — so a wall of people
 * reads as one calm system rather than a bag of pastels.
 */

import type { CSSProperties } from 'react';
import { radius, typography } from '../tokens.js';

/** Props of {@link Avatar}. */
export interface AvatarProps {
  /** The person's display name (initials are derived). */
  name: string;
  /** Diameter in pixels (default `32`). */
  size?: number;
}

/** Derives the initials of a name (up to two letters). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** Renders an initials avatar. */
export function Avatar({ name, size = 32 }: AvatarProps): JSX.Element {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius.full,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size * 0.38,
    fontWeight: typography.weights.semibold,
    letterSpacing: '0.01em',
    background: 'var(--nexora-surfaceMuted)',
    color: 'var(--nexora-textSecondary)',
    border: '1px solid var(--nexora-border)',
    flexShrink: 0,
    userSelect: 'none',
  };
  return (
    <span aria-label={name} title={name} style={style}>
      {initialsOf(name)}
    </span>
  );
}
