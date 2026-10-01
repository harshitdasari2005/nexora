import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted recursively, `undefined` dropped, so the
 * same structured facts always serialize to the same bytes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? 'null';
}

function canonicalize(value: unknown): unknown {
  // A Date has no enumerable keys: without this every instant would serialize to `{}` and
  // two different timestamps would share a fingerprint.
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .filter((key) => source[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(source[key])]),
    );
  }
  return value;
}

/** sha256 (hex) of the canonical JSON of `value`. Integrity, not secrecy. */
export function fingerprintOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
