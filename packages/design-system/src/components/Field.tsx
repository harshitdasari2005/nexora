/**
 * @nexora/design-system — form controls.
 *
 * Labeled inputs and selects with hint/error states (DESIGN_SYSTEM.md §8
 * forms; §10 error states).
 */

import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { motion, radius, spacing, typography } from '../tokens.js';
import { Stack } from './Stack.js';

/** Base styling shared by inputs and selects. */
const controlStyle: React.CSSProperties = {
  width: '100%',
  height: 38,
  paddingInline: spacing[3],
  background: 'var(--nexora-surface)',
  border: '1px solid var(--nexora-borderStrong)',
  borderRadius: radius.md,
  fontSize: typography.sizes.base,
  color: 'var(--nexora-text)',
  outline: 'none',
  transition: `border-color ${motion.duration.fast} ${motion.easing.standard}, box-shadow ${motion.duration.fast} ${motion.easing.standard}`,
};

/** Props of {@link Field}. */
export interface FieldProps {
  /** The field label. */
  label: string;
  /** Short helper text under the control. */
  hint?: string;
  /** Error text; replaces the hint and tints the control. */
  error?: string;
  /** Whether the field is required (label asterisk). */
  required?: boolean;
  /** The control children (Input or Select). */
  children: ReactNode;
}

/** A labeled form field with hint/error states. */
export function Field({ label, hint, error, required, children }: FieldProps): JSX.Element {
  return (
    <Stack gap={1.5} stretch>
      <label style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}>
        {label}
        {required ? <span style={{ color: 'var(--nexora-danger)' }}> *</span> : null}
      </label>
      {children}
      {error !== undefined ? (
        <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
          {error}
        </span>
      ) : hint !== undefined ? (
        <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          {hint}
        </span>
      ) : null}
    </Stack>
  );
}

/** Props of {@link Input}. */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Invalid state (danger border). */
  invalid?: boolean;
}

/** A styled text input. */
export function Input({ invalid = false, style, ...rest }: InputProps): JSX.Element {
  const merged: CSSProperties = {
    ...controlStyle,
    borderColor: invalid ? 'var(--nexora-danger)' : undefined,
    ...style,
  };
  return <input style={merged} {...rest} />;
}

/** Props of {@link Select}. */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Invalid state (danger border). */
  invalid?: boolean;
}

/** A styled native select. */
export function Select({ invalid = false, style, children, ...rest }: SelectProps): JSX.Element {
  const merged: CSSProperties = {
    ...controlStyle,
    borderColor: invalid ? 'var(--nexora-danger)' : undefined,
    ...style,
  };
  return (
    <select style={merged} {...rest}>
      {children}
    </select>
  );
}
