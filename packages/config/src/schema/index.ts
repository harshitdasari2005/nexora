/**
 * @nexora/config — configuration schema.
 *
 * The schema declares every configuration key the platform understands, its
 * kind, requiredness, and default. Schema validation is the single gate every
 * provider value passes before it is accepted (ENGINEERING_PLAYBOOK.md §4.2 —
 * errors are data, not thrown control flow).
 */

import { ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';

import type { ConfigKey, ConfigValue, ConfigValueKind } from '../types/index.js';

/** A single configuration key definition. */
export interface ConfigKeyDefinition {
  /** Dot-notation key path, e.g. `app.port`. */
  key: ConfigKey;
  /** Declared value kind. */
  kind: ConfigValueKind;
  /** Whether the key is required at startup (no default, must be supplied). */
  required: boolean;
  /** Default value used when no provider supplies the key. */
  default?: ConfigValue;
  /** Human-readable description of the key's purpose. */
  description?: string;
  /** Whether the value is a secret and must never be logged. */
  secret?: boolean;
  /** Validation bounds for numeric keys. */
  numberBounds?: { min?: number; max?: number };
  /** Maximum length for string keys. */
  maxLength?: number;
}

/** A map of key definitions keyed by their {@link ConfigKey}. */
export type ConfigSchemaMap = Readonly<Record<string, ConfigKeyDefinition>>;

/**
 * Validates a value against a key definition. Returns a {@link FieldIssue}
 * or `null`. Used by both schema loading and runtime writes.
 */
export function validateConfigValue(
  key: ConfigKey,
  definition: ConfigKeyDefinition,
  value: ConfigValue,
): FieldIssue | null {
  switch (definition.kind) {
    case 'string': {
      if (typeof value !== 'string') {
        return { path: key, message: `Expected a string, got ${typeof value}` };
      }
      if (definition.maxLength !== undefined && value.length > definition.maxLength) {
        return { path: key, message: `Must be at most ${definition.maxLength} characters` };
      }
      return null;
    }
    case 'number': {
      if (typeof value !== 'number') {
        return { path: key, message: `Expected a number, got ${typeof value}` };
      }
      const bounds = definition.numberBounds;
      if (bounds?.min !== undefined && value < bounds.min) {
        return { path: key, message: `Must be at least ${bounds.min}` };
      }
      if (bounds?.max !== undefined && value > bounds.max) {
        return { path: key, message: `Must be at most ${bounds.max}` };
      }
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : { path: key, message: `Expected a boolean, got ${typeof value}` };
    case 'string_array':
      return Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? null
        : { path: key, message: 'Expected an array of strings' };
    case 'number_array':
      return Array.isArray(value) && value.every((item) => typeof item === 'number')
        ? null
        : { path: key, message: 'Expected an array of numbers' };
  }
}

/**
 * Validates a full set of values against a schema. Returns a
 * {@link ValidationError} carrying every field issue when the set is invalid,
 * or the values unchanged when valid.
 */
export function validateConfigValues(
  schema: ConfigSchemaMap,
  values: Readonly<Record<string, ConfigValue>>,
): ValidationError | null {
  const issues: FieldIssue[] = [];
  for (const entry of Object.entries(values)) {
    const definition = schema[entry[0]];
    if (definition === undefined) {
      issues.push({ path: entry[0], message: 'Key is not declared in the configuration schema' });
      continue;
    }
    const issue = validateConfigValue(entry[0] as ConfigKey, definition, entry[1]);
    if (issue !== null) {
      issues.push(issue);
    }
  }
  if (issues.length === 0) {
    return null;
  }
  return new ValidationError('Configuration validation failed', issues);
}

/**
 * Returns every required key in the schema that has no default value.
 * These keys must be supplied by a provider or the environment at load time.
 */
export function requiredKeys(schema: ConfigSchemaMap): readonly ConfigKey[] {
  return Object.values(schema)
    .filter((definition) => definition.required && definition.default === undefined)
    .map((definition) => definition.key);
}
