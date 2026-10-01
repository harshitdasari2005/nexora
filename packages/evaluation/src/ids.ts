/**
 * @nexora/evaluation — deterministic identifiers.
 *
 * Every fixture id is derived from a stable name (never random), so the same
 * dataset version always seeds byte-identical rows: re-seeding is idempotent,
 * reports are comparable across runs, and a reset can target exactly the
 * rows a seed created. Ids keep the platform's `<prefix>_<uuid-v4-shape>`
 * format so they pass every validator a randomly generated id passes.
 */

import { createHash } from 'node:crypto';

/**
 * Derives a stable `<prefix>_<uuid>` id from a namespace-qualified name. The
 * UUID is shaped as version 4 / RFC 4122 variant so the platform's UUID
 * validators accept it.
 */
export function deterministicId(prefix: string, name: string): string {
  const hex = createHash('sha256').update(`nexora-scenarios:${prefix}:${name}`).digest('hex');
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  const uuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
  return `${prefix}_${uuid}`;
}

/** A stable content fingerprint (sha256 hex) of any JSON-serializable value. */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** JSON serialization with sorted object keys (order-independent fingerprints). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}
