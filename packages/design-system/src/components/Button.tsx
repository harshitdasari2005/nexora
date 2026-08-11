/**
 * @nexora/design-system — Button.
 *
 * The primary action control (DESIGN_SYSTEM.md §5, §10 interaction): variants
 * for emphasis, sizes, a loading state, and keyboard/disabled semantics.
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
  sm: { height: 32, paddingInline: spacing[3], fontSize: typography.sizes.sm },
  md: { height: 38, paddingInline: spacing[4], fontSize: typography.sizes.base },
  lg: { height: 44, paddingInline: spacing[5], fontSize: typography.sizes.md },
};

/** Renders a styled button. */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  children,
  disabled,
  style,
  ...rest
}: ButtonProps): JSX.Element {
  const variantStyle = getVariantStyle(variant);
  return (
    <button
      type="button"
      disabled={disabled || loading}
      style={{
        ...sizeStyles[size],
        ...variantStyle,
        ...(fullWidth ? { width: '100%' } : null),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing[2],
        borderRadius: radius.md,
        fontWeight: typography.weights.medium,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.6 : 1,
        border: 'none',
        transition: `background-color ${motion.duration.fast} ${motion.easing.standard}, box-shadow ${motion.duration.fast} ${motion.easing.standard}`,
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {loading ? <Spinner size={14} tone={variant === 'primary' ? 'light' : 'dark'} /> : null}
      {children}
    </button>
  );
}

function getVariantStyle(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case 'primary':
      return {
        background: 'var(--nexora-primary)',
        color: 'var(--nexora-primaryForeground)',
        boxShadow: '0 1px 2px rgba(28, 25, 23, 0.2)',
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
      };
    case 'danger':
      return {
        background: 'var(--nexora-danger)',
        color: '#ffffff',
      };
  }
}
