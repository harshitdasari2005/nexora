/**
 * @nexora/config — environment loader.
 *
 * Reads and parses typed values from the process environment. The loader is
 * deliberately minimal: it parses primitives (string / number / boolean /
 * JSON arrays) and treats every lookup as optional — requiredness is decided
 * by the schema, not the loader (BKD.md §11 configuration safety).
 */

import type { ConfigValue } from '../types/index.js';

/**
 * Parses a raw string into a typed config value.
 *
 * @param raw - the raw environment string (already present).
 * @returns the parsed value, or `null` when the string is not parseable as
 *   the requested kind.
 */
export function parseEnvValue(
  raw: string,
  kind: 'string' | 'number' | 'boolean' | 'string_array' | 'number_array',
): ConfigValue | null {
  switch (kind) {
    case 'string':
      return raw;
    case 'number': {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case 'boolean':
      return parseBoolean(raw);
    case 'string_array':
      return raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    case 'number_array': {
      const parts = raw.split(',').map((part) => Number(part.trim()));
      return parts.every((part) => Number.isFinite(part)) ? parts : null;
    }
  }
}

/** Parses a boolean literal (`true`/`false`/`1`/`0`), case-insensitive. */
function parseBoolean(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return null;
}

/**
 * Loads a typed configuration value from the environment, or `undefined`
 * when the variable is not set and `null` when it is set but unparseable.
 */
export function loadEnvValue(
  env: NodeJS.ProcessEnv,
  name: string,
  kind: 'string' | 'number' | 'boolean' | 'string_array' | 'number_array',
): ConfigValue | undefined | null {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return undefined;
  }
  return parseEnvValue(raw, kind);
}

/**
 * Reads a boolean flag from the environment. `true` when the variable is
 * present and parseable as true; `false` when present and false; `undefined`
 * when absent; `null` when present but unparseable.
 */
export function loadEnvBoolean(env: NodeJS.ProcessEnv, name: string): boolean | undefined | null {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return undefined;
  }
  return parseBoolean(raw);
}
