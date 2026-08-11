/**
 * @nexora/design-system — Avatar.
 *
 * An initials avatar (DESIGN_SYSTEM.md §8 identity components). The tone is
 * derived from the name so the same person always gets the same color.
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

/** Deterministic pastel tones for avatars. */
const AVATAR_TONES = [
  { background: '#e0e7ff', color: '#4338ca' },
  { background: '#fce7f3', color: '#be185d' },
  { background: '#d1fae5', color: '#047857' },
  { background: '#fef3c7', color: '#b45309' },
  { background: '#e0e7ff', color: '#4f46e5' },
  { background: '#fae8ff', color: '#a21caf' },
] as const;

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
  const hash = [...name].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length] ?? AVATAR_TONES[0]!;
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius.full,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size * 0.38,
    fontWeight: typography.weights.semibold,
    background: tone.background,
    color: tone.color,
    flexShrink: 0,
    userSelect: 'none',
  };
  return (
    <span aria-label={name} title={name} style={style}>
      {initialsOf(name)}
    </span>
  );
}
