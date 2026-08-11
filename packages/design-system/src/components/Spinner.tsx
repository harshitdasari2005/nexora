/**
 * @nexora/design-system — Spinner.
 *
 * A lightweight loading indicator (DESIGN_SYSTEM.md §10 loading states).
 */

import type { CSSProperties } from 'react';

/** Props of {@link Spinner}. */
export interface SpinnerProps {
  /** Diameter in pixels (default `18`). */
  size?: number;
  /** Border width in pixels (default `2`). */
  borderWidth?: number;
  /** Tone: `light` on colored surfaces, `dark` on light surfaces. */
  tone?: 'light' | 'dark';
}

/** Renders an animated spinner. */
export function Spinner({ size = 18, borderWidth = 2, tone = 'dark' }: SpinnerProps): JSX.Element {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    border: `${borderWidth}px solid ${
      tone === 'light' ? 'rgba(255, 255, 255, 0.35)' : 'var(--nexora-borderStrong)'
    }`,
    borderTopColor: tone === 'light' ? '#ffffff' : 'var(--nexora-primary)',
    animation: 'nexora-spin 0.7s linear infinite',
    flexShrink: 0,
  };
  return <span aria-label="Loading" role="status" style={style} />;
}
