/**
 * @nexora/shared — generic utility helpers.
 *
 * Small, pure, framework-agnostic helpers shared by all modules. Kept minimal
 * on purpose (ENGINEERING_PLAYBOOK.md §2 YAGNI/KISS): anything that carries
 * domain meaning belongs in the domain module, not here.
 */

import { err, ok, type Result } from '../result/index.js';

/**
 * Recursively freezes an object and its nested objects/arrays so it cannot be
 * mutated at runtime. Useful for shared constants and configuration tables.
 *
 * @returns the input value, now deeply frozen.
 */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value as Readonly<T>;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value as Readonly<T>;
}

/** Returns true when the value is a plain (non-null, non-array) object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns true when the value is a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Exhaustiveness check for switch statements over union types. Call in the
 * `default` branch; the type system errors if a case was missed.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value reached assertNever: ${String(value)}`);
}

/**
 * Safely parses a JSON string. Returns a {@link Result} so callers handle
 * malformed input as data, never as a thrown exception.
 *
 * @param input   - the JSON text to parse.
 * @param onError - optional mapping of the parse error to the failure type.
 */
export function safeJsonParse<T>(
  input: string,
  onError?: (error: Error) => Error,
): Result<T, Error> {
  try {
    return ok(JSON.parse(input) as T);
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    return err(onError ? onError(error) : error);
  }
}

/**
 * Returns a shallow copy of the object with `undefined` values removed.
 * Useful before serializing records that must not contain `undefined` fields.
 */
export function compact<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      out[key] = entry;
    }
  }
  return out;
}
