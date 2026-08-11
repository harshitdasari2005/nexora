/**
 * @nexora/config — validation.
 *
 * Validates a complete configuration payload (a merged set of values)
 * against a schema: every value is type-checked, and every required key with
 * no default must be present. This is the gate a loaded configuration passes
 * before it becomes the active configuration.
 */

import { ValidationError } from '@nexora/shared/errors';

import { requiredKeys, validateConfigValues, type ConfigSchemaMap } from '../schema/index.js';
import type { ConfigKey, ConfigValue } from '../types/index.js';

/**
 * Validates a merged configuration payload. Fails when:
 * - a value does not match its declared kind/bounds, or
 * - a required key with no default is missing.
 *
 * @returns the validated payload (the input, unchanged) or a
 *   {@link ValidationError} describing every problem found.
 */
export function validateConfiguration(
  schema: ConfigSchemaMap,
  values: Readonly<Record<string, ConfigValue>>,
): ValidationError | null {
  const typeIssue = validateConfigValues(schema, values);
  if (typeIssue !== null) {
    return typeIssue;
  }

  const missing = requiredKeys(schema).filter((key) => values[key] === undefined);
  if (missing.length > 0) {
    return new ValidationError(
      'Configuration is missing required keys',
      missing.map((key) => ({ path: key, message: 'Required key is missing' })),
    );
  }
  return null;
}

/**
 * Returns the subset of keys in `values` that are not declared in the
 * schema. Callers may log these as a warning (undeclared keys are ignored,
 * never rejected, so forward compatibility is preserved).
 */
export function undeclaredKeys(
  schema: ConfigSchemaMap,
  values: Readonly<Record<string, ConfigValue>>,
): readonly ConfigKey[] {
  return Object.keys(values).filter(
    (key) => schema[key] === undefined,
  ) as unknown as readonly ConfigKey[];
}
