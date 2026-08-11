/**
 * Unit tests for the environment loader (`src/environment`).
 */

import { describe, expect, it } from 'vitest';

import { loadEnvBoolean, loadEnvValue, parseEnvValue } from '../src/environment/index.js';

describe('parseEnvValue', () => {
  it('parses strings verbatim', () => {
    expect(parseEnvValue('hello', 'string')).toBe('hello');
  });

  it('parses finite numbers', () => {
    expect(parseEnvValue('8080', 'number')).toBe(8080);
  });

  it('rejects non-finite numbers', () => {
    expect(parseEnvValue('not-a-number', 'number')).toBeNull();
    expect(parseEnvValue('Infinity', 'number')).toBeNull();
  });

  it('parses boolean literals case-insensitively', () => {
    expect(parseEnvValue('true', 'boolean')).toBe(true);
    expect(parseEnvValue('TRUE', 'boolean')).toBe(true);
    expect(parseEnvValue('1', 'boolean')).toBe(true);
    expect(parseEnvValue('false', 'boolean')).toBe(false);
    expect(parseEnvValue('0', 'boolean')).toBe(false);
  });

  it('rejects unparseable booleans', () => {
    expect(parseEnvValue('yes', 'boolean')).toBeNull();
  });

  it('parses comma-separated string arrays, trimming and dropping empties', () => {
    expect(parseEnvValue('a, b, ,c', 'string_array')).toEqual(['a', 'b', 'c']);
    expect(parseEnvValue('', 'string_array')).toEqual([]);
  });

  it('parses comma-separated number arrays', () => {
    expect(parseEnvValue('1, 2, 3', 'number_array')).toEqual([1, 2, 3]);
  });

  it('rejects number arrays with non-numeric parts', () => {
    expect(parseEnvValue('1, x', 'number_array')).toBeNull();
  });
});

describe('loadEnvValue', () => {
  it('returns undefined when the variable is absent or empty', () => {
    expect(loadEnvValue({}, 'NEXORA_APP_PORT', 'number')).toBeUndefined();
    expect(loadEnvValue({ NEXORA_APP_PORT: '' }, 'NEXORA_APP_PORT', 'number')).toBeUndefined();
  });

  it('returns null when present but unparseable', () => {
    expect(loadEnvValue({ NEXORA_APP_PORT: 'abc' }, 'NEXORA_APP_PORT', 'number')).toBeNull();
  });

  it('returns the parsed value when present', () => {
    expect(loadEnvValue({ NEXORA_APP_PORT: '8080' }, 'NEXORA_APP_PORT', 'number')).toBe(8080);
  });
});

describe('loadEnvBoolean', () => {
  it('returns undefined when absent and null when unparseable', () => {
    expect(loadEnvBoolean({}, 'NEXORA_FEATURE_X')).toBeUndefined();
    expect(loadEnvBoolean({ NEXORA_FEATURE_X: 'maybe' }, 'NEXORA_FEATURE_X')).toBeNull();
  });

  it('returns the parsed boolean when present', () => {
    expect(loadEnvBoolean({ NEXORA_FEATURE_X: 'false' }, 'NEXORA_FEATURE_X')).toBe(false);
  });
});
