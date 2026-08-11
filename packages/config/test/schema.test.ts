/**
 * Unit tests for the schema and configuration validation (`src/schema`,
 * `src/validation`).
 */

import { describe, expect, it } from 'vitest';
import { isValidationError } from '@nexora/shared/errors';

import { requiredKeys, validateConfigValue, validateConfigValues } from '../src/schema/index.js';
import { validateConfiguration } from '../src/validation/index.js';
import type { ConfigKey, ConfigValue } from '../src/types/index.js';
import type { ConfigSchemaMap } from '../src/schema/index.js';

const key = (value: string): ConfigKey => value as ConfigKey;

const schema: ConfigSchemaMap = {
  [key('app.port')]: {
    key: key('app.port'),
    kind: 'number',
    required: true,
    numberBounds: { min: 1, max: 65535 },
  },
  [key('app.name')]: { key: key('app.name'), kind: 'string', required: true, maxLength: 40 },
  [key('app.debug')]: { key: key('app.debug'), kind: 'boolean', required: false, default: false },
  [key('app.hosts')]: { key: key('app.hosts'), kind: 'string_array', required: false, default: [] },
};

describe('validateConfigValue', () => {
  it('accepts a matching string within bounds', () => {
    expect(validateConfigValue(key('app.name'), schema['app.name']!, 'nexora')).toBeNull();
  });

  it('rejects a string that is too long', () => {
    const issue = validateConfigValue(key('app.name'), schema['app.name']!, 'x'.repeat(41));
    expect(issue).not.toBeNull();
    expect(issue?.path).toBe('app.name');
  });

  it('rejects a wrong type', () => {
    expect(validateConfigValue(key('app.debug'), schema['app.debug']!, 'yes')).not.toBeNull();
  });

  it('enforces number bounds', () => {
    expect(validateConfigValue(key('app.port'), schema['app.port']!, 70000)).not.toBeNull();
    expect(validateConfigValue(key('app.port'), schema['app.port']!, 8080)).toBeNull();
  });

  it('validates homogeneous arrays', () => {
    const strings: readonly string[] = ['a', 'b'];
    const mixed = ['a', 1] as unknown as ConfigValue;
    expect(validateConfigValue(key('app.hosts'), schema['app.hosts']!, strings)).toBeNull();
    expect(validateConfigValue(key('app.hosts'), schema['app.hosts']!, mixed)).not.toBeNull();
  });
});

describe('validateConfigValues', () => {
  it('flags undeclared keys', () => {
    const error = validateConfigValues(schema, { 'nope.key': 1 });
    expect(error).not.toBeNull();
    expect(error?.issues[0]?.path).toBe('nope.key');
  });

  it('returns null for a valid set', () => {
    expect(validateConfigValues(schema, { 'app.port': 8080 })).toBeNull();
  });
});

describe('validateConfiguration', () => {
  it('passes when required keys are present and values are valid', () => {
    const error = validateConfiguration(schema, { 'app.port': 8080, 'app.name': 'nexora' });
    expect(error).toBeNull();
  });

  it('fails when a required key is missing', () => {
    const error = validateConfiguration(schema, { 'app.port': 8080 });
    expect(error).not.toBeNull();
    expect(isValidationError(error)).toBe(true);
    expect(error?.issues.map((issue) => issue.path)).toContain('app.name');
  });

  it('fails when a value is invalid', () => {
    const error = validateConfiguration(schema, { 'app.port': -5, 'app.name': 'nexora' });
    expect(error).not.toBeNull();
    expect(error?.issues.map((issue) => issue.path)).toContain('app.port');
  });
});

describe('requiredKeys', () => {
  it('returns only required keys without defaults', () => {
    const keys = requiredKeys(schema);
    expect(keys).toEqual([key('app.port'), key('app.name')]);
  });
});
