/**
 * @nexora/design-system — Skeleton.
 *
 * A shimmering placeholder for loading content (DESIGN_SYSTEM.md §10 loading
 * states; FRONTEND.md §13 progressive rendering).
 */

import type { CSSProperties } from 'react';
import { motion, radius } from '../tokens.js';

/** Props of {@link Skeleton}. */
export interface SkeletonProps {
  /** Height in pixels (default `14`). */
  height?: number;
  /** Width in pixels; omit for 100%. */
  width?: number;
  /** Corner radius override. */
  radiusValue?: string;
  /** Whether the skeleton is a circle. */
  circle?: boolean;
}

/** Renders a shimmering placeholder block. */
export function Skeleton({
  height = 14,
  width,
  radiusValue,
  circle = false,
}: SkeletonProps): JSX.Element {
  const style: CSSProperties = {
    height,
    width: circle ? height : width,
    borderRadius: circle ? '50%' : (radiusValue ?? radius.sm),
    background: 'var(--nexora-surfaceMuted)',
    animation: `nexora-pulse ${motion.duration.slow} ${motion.easing.standard} infinite`,
  };
  return <span aria-hidden style={{ display: 'block', ...style }} />;
}
