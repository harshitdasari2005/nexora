/**
 * @nexora/design-system — form controls.
 *
 * Labeled inputs and selects with hint/error states (DESIGN_SYSTEM.md §8
 * forms; §10 error states). Focus/hover states live in `GlobalStyles`
 * (`.nexora-input`); the native select gets a hand-drawn chevron so it
 * matches the input rather than the OS.
 */

import type {
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { motion, radius, spacing, typography } from '../tokens.js';
import { Stack } from './Stack.js';

/** Base styling shared by inputs and selects. */
const controlStyle: React.CSSProperties = {
  width: '100%',
  height: 'var(--nexora-control-md, 38px)',
  paddingInline: spacing[3],
  background: 'var(--nexora-surface)',
  border: '1px solid var(--nexora-borderStrong)',
  borderRadius: radius.md,
  fontSize: typography.sizes.base,
  color: 'var(--nexora-text)',
  outline: 'none',
  transition: `border-color ${motion.duration.fast} ${motion.easing.standard}, box-shadow ${motion.duration.fast} ${motion.easing.standard}`,
};

/** A subtle down-chevron for native selects (data URI so no asset). */
const SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%237d7d7d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

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
      <label
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          color: 'var(--nexora-text)',
        }}
      >
        {label}
        {required ? <span style={{ color: 'var(--nexora-textMuted)' }}> *</span> : null}
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
export function Input({ invalid = false, className, style, ...rest }: InputProps): JSX.Element {
  const merged: CSSProperties = {
    ...controlStyle,
    borderColor: invalid ? 'var(--nexora-danger)' : undefined,
    ...style,
  };
  return (
    <input
      className={['nexora-input', invalid ? 'nexora-input-invalid' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={merged}
      {...rest}
    />
  );
}

/** Props of {@link Textarea}. */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Invalid state (danger border). */
  invalid?: boolean;
}

/** A styled multi-line text input (grows with `rows`; resizable vertically). */
export function Textarea({
  invalid = false,
  className,
  style,
  rows = 3,
  ...rest
}: TextareaProps): JSX.Element {
  const merged: CSSProperties = {
    ...controlStyle,
    height: 'auto',
    minHeight: 'var(--nexora-control-md, 38px)',
    paddingBlock: spacing[2],
    lineHeight: 1.5,
    resize: 'vertical',
    borderColor: invalid ? 'var(--nexora-danger)' : undefined,
    ...style,
  };
  return (
    <textarea
      rows={rows}
      className={['nexora-input', invalid ? 'nexora-input-invalid' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={merged}
      {...rest}
    />
  );
}

/** Props of {@link Select}. */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Invalid state (danger border). */
  invalid?: boolean;
}

/** A styled native select. */
export function Select({
  invalid = false,
  className,
  style,
  children,
  ...rest
}: SelectProps): JSX.Element {
  const merged: CSSProperties = {
    ...controlStyle,
    borderColor: invalid ? 'var(--nexora-danger)' : undefined,
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    paddingRight: spacing[8],
    backgroundImage: SELECT_CHEVRON,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `right ${spacing[2.5]} center`,
    cursor: 'pointer',
    ...style,
  };
  return (
    <select
      className={['nexora-input', invalid ? 'nexora-input-invalid' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={merged}
      {...rest}
    >
      {children}
    </select>
  );
}
