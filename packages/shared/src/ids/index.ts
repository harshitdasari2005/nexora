/**
 * @nexora/shared — ID utilities.
 *
 * All platform identifiers are RFC-4122 v4 UUIDs generated from the OS
 * cryptographic source (PERSISTENCE.md §1 aggregate ownership; AUD-*). The
 * `prefixedId` helper produces human-recognizable ids such as
 * `emp_9f8b...` while keeping the UUID payload for collision safety.
 */

import { randomUUID } from 'node:crypto';

/**
 * Generates a UUID v4 string.
 *
 * @returns a new random UUID, e.g. `9f8b1c2d-...`.
 */
export function uuid(): string {
  return randomUUID();
}

/** Canonical UUID v4 regular expression (lowercase, hyphenated). */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns true when the value is a syntactically valid UUID v4 string.
 */
export function isValidUuid(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

/** Allowed characters in an id prefix (lowercase letters only). */
const PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Generates a prefixed entity id: `{prefix}_{uuid}`. The prefix identifies the
 * entity kind (e.g. `emp`, `prj`, `evt`) for readability and searchability
 * while the UUID provides global uniqueness.
 *
 * @param prefix - lowercase entity prefix (letters, digits, underscore).
 * @throws {TypeError} when the prefix does not match the allowed pattern.
 */
export function prefixedId(prefix: string): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new TypeError(`Invalid id prefix: ${JSON.stringify(prefix)}`);
  }
  return `${prefix}_${uuid()}`;
}

/**
 * Generates a correlation id for tracing an execution across services and
 * events (SAD.md §11.6 correlation ids; API_CONTRACTS.md §13).
 */
export function correlationId(): string {
  return `corr_${uuid()}`;
}

/**
 * Generates a request id for the immediate request/execution context.
 */
export function requestId(): string {
  return `req_${uuid()}`;
}

/**
 * Extracts the prefix of a {@link prefixedId}, or `null` when the value is not
 * a well-formed prefixed id.
 *
 * @example
 * ```ts
 * idPrefix('emp_9f8b...') // 'emp'
 * ```
 */
export function idPrefix(value: string): string | null {
  const index = value.indexOf('_');
  if (index <= 0) {
    return null;
  }
  const prefix = value.slice(0, index);
  return PREFIX_PATTERN.test(prefix) && isValidUuid(value.slice(index + 1)) ? prefix : null;
}
