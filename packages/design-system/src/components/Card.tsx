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

/** An elevated surface container. */
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
    background: 'var(--nexora-surface)',
    border: '1px solid var(--nexora-border)',
    borderRadius: radius.lg,
    boxShadow: elevation[elevationLevel],
    padding: spacing[padding],
    transition: `box-shadow ${motion.duration.base} ${motion.easing.standard}, transform ${motion.duration.base} ${motion.easing.emphasis}`,
    ...extraStyle,
  };
  if (interactive) {
    style.cursor = 'pointer';
    style.outlineOffset = '2px';
  }
  return (
    <div
      id={id}
      className={className}
      style={style}
      onMouseEnter={
        interactive
          ? (event) => {
              event.currentTarget.style.boxShadow = elevation.md;
            }
          : undefined
      }
      onMouseLeave={
        interactive
          ? (event) => {
              event.currentTarget.style.boxShadow = elevation[elevationLevel];
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
