/**
 * @nexora/shared — validation helpers.
 *
 * Dependency-free validators that return a {@link ValidationIssue} or `null`,
 * so callers can compose them without throwing. Field issues are the same
 * shape consumed by {@link ValidationError} (API_CONTRACTS.md §10).
 */

import type { FieldIssue } from '../errors/index.js';
import { isValidUuid } from '../ids/index.js';
import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from '../constants/index.js';

/**
 * A single validation finding: the field path and a human-readable message.
 * Structural alias of `FieldIssue`; kept under the validation namespace for
 * import ergonomics.
 */
export type ValidationIssue = FieldIssue;

/**
 * Returns a {@link ValidationIssue} for the field, or `null` when the value is
 * a non-empty string.
 */
export function required(field: string, value: unknown): ValidationIssue | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { path: field, message: 'Value is required' };
  }
  return null;
}

/**
 * Returns a {@link ValidationIssue} when the string is longer than `max`.
 */
export function maxLength(field: string, value: string, max: number): ValidationIssue | null {
  if (value.length > max) {
    return { path: field, message: `Must be at most ${max} characters` };
  }
  return null;
}

/**
 * Returns a {@link ValidationIssue} when the string is shorter than `min`.
 */
export function minLength(field: string, value: string, min: number): ValidationIssue | null {
  if (value.length < min) {
    return { path: field, message: `Must be at least ${min} characters` };
  }
  return null;
}

/**
 * Returns a {@link ValidationIssue} when the value is not a syntactically
 * valid email address. Uses a pragmatic pattern; real delivery validation is
 * out of scope here.
 */
export function isEmail(field: string, value: string): ValidationIssue | null {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!pattern.test(value)) {
    return { path: field, message: 'Must be a valid email address' };
  }
  return null;
}

/**
 * Returns a {@link ValidationIssue} when the value is not a syntactically
 * valid UUID v4.
 */
export function isUuid(field: string, value: string): ValidationIssue | null {
  if (!isValidUuid(value)) {
    return { path: field, message: 'Must be a valid UUID' };
  }
  return null;
}

/**
 * Returns a {@link ValidationIssue} when `value` is not one of `allowed`.
 */
export function oneOf<T extends string>(
  field: string,
  value: string,
  allowed: readonly T[],
): ValidationIssue | null {
  if (!(allowed as readonly string[]).includes(value)) {
    return { path: field, message: `Must be one of: ${allowed.join(', ')}` };
  }
  return null;
}

/**
 * Returns a {@link ValidationIssue} when `value` is not an integer within
 * `[min, max]`.
 */
export function isIntInRange(
  field: string,
  value: unknown,
  min: number,
  max: number,
): ValidationIssue | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return { path: field, message: `Must be an integer between ${min} and ${max}` };
  }
  return null;
}

/**
 * Returns a {@link ValidationIssue} when the value is longer than the shared
 * name-length convention (`MAX_NAME_LENGTH`).
 */
export function isValidName(field: string, value: string): ValidationIssue | null {
  const base = required(field, value);
  if (base !== null) {
    return base;
  }
  return maxLength(field, value, MAX_NAME_LENGTH);
}

/**
 * Returns a {@link ValidationIssue} when the value is longer than the shared
 * text-length convention (`MAX_TEXT_LENGTH`).
 */
export function isValidText(field: string, value: string): ValidationIssue | null {
  return maxLength(field, value, MAX_TEXT_LENGTH);
}

/**
 * Runs every validator and returns the non-null issues in order.
 * Returns an empty array when all validators pass.
 */
export function collectIssues(
  validators: ReadonlyArray<ValidationIssue | null>,
): ValidationIssue[] {
  return validators.filter((issue): issue is ValidationIssue => issue !== null);
}
