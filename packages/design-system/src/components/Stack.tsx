/**
 * @nexora/design-system — Stack.
 *
 * A flex layout primitive (DESIGN_SYSTEM.md §4 layout system): column or row
 * with a consistent gap from the spacing scale.
 */

import type { CSSProperties, ReactNode } from 'react';
import { spacing } from '../tokens.js';

type SpacingKey = keyof typeof spacing;

/** Props of {@link Stack}. */
export interface StackProps {
  /** Layout direction (default `column`). */
  direction?: 'column' | 'row';
  /** Gap from the spacing scale (default `4`). */
  gap?: SpacingKey;
  /** Horizontal alignment. */
  align?: CSSProperties['alignItems'];
  /** Vertical/justify alignment. */
  justify?: CSSProperties['justifyContent'];
  /** Whether children should stretch to fill the cross axis. */
  stretch?: boolean;
  /** Optional id. */
  id?: string;
  /** Class name pass-through. */
  className?: string;
  /** Extra style pass-through. */
  style?: CSSProperties;
  /** Children. */
  children: ReactNode;
}

/** A flex layout primitive with a spacing-scale gap. */
export function Stack({
  direction = 'column',
  gap = 4,
  align,
  justify,
  stretch = false,
  id,
  className,
  style: extraStyle,
  children,
}: StackProps): JSX.Element {
  const style: CSSProperties = {
    display: 'flex',
    flexDirection: direction,
    gap: spacing[gap],
    alignItems: stretch ? 'stretch' : align,
    justifyContent: justify,
    minWidth: 0,
    minHeight: 0,
    ...extraStyle,
  };
  return (
    <div id={id} className={className} style={style}>
      {children}
    </div>
  );
}
