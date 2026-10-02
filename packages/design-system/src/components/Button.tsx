/**
 * @nexora/design-system — Button.
 *
 * The primary action control (DESIGN_SYSTEM.md §5, §10 interaction): variants
 * for emphasis, sizes, a loading state, and keyboard/disabled semantics.
 * Solid black primary, hairline-bordered secondary, quiet ghost — hover
 * states live in `GlobalStyles` (`.nexora-btn-*`).
 */

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { motion, radius, spacing, typography } from '../tokens.js';
import { Spinner } from './Spinner.js';

/** Visual variants of {@link Button}. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Size variants of {@link Button}. */
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Props of {@link Button}. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant (default `primary`). */
  variant?: ButtonVariant;
  /** Size (default `md`). */
  size?: ButtonSize;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  /** Makes the button span its container. */
  fullWidth?: boolean;
  /** Button content. */
  children: ReactNode;
}

const sizeStyles: Record<ButtonSize, CSSProperties> = {
  sm: {
    height: 'var(--nexora-control-sm, 32px)',
    paddingInline: spacing[3],
    fontSize: typography.sizes.sm,
  },
  md: {
    height: 'var(--nexora-control-md, 38px)',
    paddingInline: spacing[4],
    fontSize: typography.sizes.base,
  },
  lg: {
    height: 'var(--nexora-control-lg, 44px)',
    paddingInline: spacing[5],
    fontSize: typography.sizes.base,
  },
};

/** Renders a styled button. */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  children,
  disabled,
  className,
  style,
  ...rest
}: ButtonProps): JSX.Element {
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      disabled={isDisabled}
      className={[`nexora-btn nexora-btn-${variant}`, className].filter(Boolean).join(' ')}
      style={{
        ...sizeStyles[size],
        ...getVariantStyle(variant),
        ...(fullWidth ? { width: '100%' } : null),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing[2],
        borderRadius: radius.md,
        fontWeight: 'var(--nexora-control-weight, 600)' as unknown as number,
        letterSpacing: '-0.006em',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.45 : 1,
        transition: `background-color ${motion.duration.fast} ${motion.easing.standard}, border-color ${motion.duration.fast} ${motion.easing.standard}, color ${motion.duration.fast} ${motion.easing.standard}, filter ${motion.duration.fast} ${motion.easing.standard}`,
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {loading ? <Spinner size={14} tone={spinnerTone(variant)} /> : null}
      {children}
    </button>
  );
}

function spinnerTone(variant: ButtonVariant): 'light' | 'dark' {
  return variant === 'primary' || variant === 'danger' ? 'light' : 'dark';
}

function getVariantStyle(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case 'primary':
      return {
        background: 'var(--nexora-primary)',
        color: 'var(--nexora-primaryForeground)',
        border: '1px solid transparent',
      };
    case 'secondary':
      return {
        background: 'var(--nexora-surface)',
        color: 'var(--nexora-text)',
        border: '1px solid var(--nexora-borderStrong)',
      };
    case 'ghost':
      return {
        background: 'transparent',
        color: 'var(--nexora-textSecondary)',
        border: '1px solid transparent',
      };
    case 'danger':
      return {
        background: 'var(--nexora-danger)',
        color: '#ffffff',
        border: '1px solid transparent',
      };
  }
}
