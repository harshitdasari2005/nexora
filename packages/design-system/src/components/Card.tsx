/**
 * @nexora/design-system — Card.
 *
 * The elevated surface used for panels, widgets, and empty states
 * (DESIGN_SYSTEM.md §8 enterprise components).
 */

import type { CSSProperties, ReactNode } from 'react';
import { elevation, motion, radius, spacing } from '../tokens.js';

/** Props of {@link Card}. */
export interface CardProps {
  /** Padding from the spacing scale (default `6`). */
  padding?: keyof typeof spacing;
  /** Elevation level (default `sm`). */
  elevationLevel?: keyof typeof elevation;
  /** Interactive: lifts on hover and sets cursor. */
  interactive?: boolean;
  /** Optional id. */
  id?: string;
  /** Class name pass-through. */
  className?: string;
  /** Extra style pass-through. */
  style?: CSSProperties;
  /** Children. */
  children: ReactNode;
}

/**
 * An elevated surface container. In the default light theme this is a
 * plain opaque card — subtle border, restrained shadow, nothing behind it
 * to justify glass. Under `[data-theme="dark"]` (Login only, as of S44 —
 * the authenticated app no longer runs this theme) it becomes a
 * translucent glass panel over that page's 3D scene instead, via the
 * `--nexora-card*` custom properties GlobalStyles defines per theme. Every
 * page built on `Card` inherits whichever is active automatically — one
 * shared component, not a per-page rewrite.
 */
export function Card({
  padding = 6,
  elevationLevel = 'sm',
  interactive = false,
  id,
  className,
  style: extraStyle,
  children,
}: CardProps): JSX.Element {
  const style: CSSProperties = {
    background: 'var(--nexora-cardBg, var(--nexora-surface))',
    backdropFilter: 'var(--nexora-cardBackdropFilter, none)',
    WebkitBackdropFilter: 'var(--nexora-cardBackdropFilter, none)',
    border: '1px solid var(--nexora-border)',
    borderRadius: radius.lg,
    boxShadow: `${elevation[elevationLevel]}, var(--nexora-cardInsetHighlight, inset 0 1px 0 rgba(255, 255, 255, 0))`,
    padding: spacing[padding],
    transition: `box-shadow ${motion.duration.base} ${motion.easing.standard}, transform ${motion.duration.base} ${motion.easing.emphasis}`,
    ...extraStyle,
  };
  const classes = [interactive ? 'nexora-card-interactive' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div id={id} className={classes.length > 0 ? classes : undefined} style={style}>
      {children}
    </div>
  );
}
