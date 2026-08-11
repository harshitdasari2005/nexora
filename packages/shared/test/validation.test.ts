import { describe, expect, it } from 'vitest';

import {
  collectIssues,
  isEmail,
  isIntInRange,
  isUuid,
  isValidName,
  isValidText,
  maxLength,
  minLength,
  oneOf,
  required,
} from '../src/validation/index.js';

describe('validation', () => {
  it('flags missing required values', () => {
    expect(required('name', '')).not.toBeNull();
    expect(required('name', '   ')).not.toBeNull();
    expect(required('name', undefined)).not.toBeNull();
    expect(required('name', 'Alice')).toBeNull();
  });

  it('enforces min and max lengths', () => {
    expect(maxLength('code', 'toolong', 3)).not.toBeNull();
    expect(maxLength('code', 'abc', 3)).toBeNull();
    expect(minLength('code', 'a', 2)).not.toBeNull();
    expect(minLength('code', 'ab', 2)).toBeNull();
  });

  it('validates email addresses', () => {
    expect(isEmail('email', 'sarah@nexora.io')).toBeNull();
    expect(isEmail('email', 'not-an-email')).not.toBeNull();
    expect(isEmail('email', '@missing.com')).not.toBeNull();
  });

  it('validates UUIDs', () => {
    const valid = '9f8b1c2d-1111-4111-8111-111111111111';
    expect(isUuid('id', valid)).toBeNull();
    expect(isUuid('id', 'nope')).not.toBeNull();
  });

  it('validates enum membership', () => {
    expect(oneOf('status', 'active', ['active', 'inactive'])).toBeNull();
    expect(oneOf('status', 'bogus', ['active', 'inactive'])).not.toBeNull();
  });

  it('validates integer ranges', () => {
    expect(isIntInRange('page', 3, 1, 100)).toBeNull();
    expect(isIntInRange('page', 0, 1, 100)).not.toBeNull();
    expect(isIntInRange('page', 2.5, 1, 100)).not.toBeNull();
    expect(isIntInRange('page', '3', 1, 100)).not.toBeNull();
  });

  it('applies shared name and text conventions', () => {
    expect(isValidName('name', 'Alice')).toBeNull();
    expect(isValidName('name', '')).not.toBeNull();
    expect(isValidName('name', 'x'.repeat(121))).not.toBeNull();
    expect(isValidText('body', 'x'.repeat(10_001))).not.toBeNull();
  });

  it('collects only the failing issues in order', () => {
    const issues = collectIssues([
      required('name', ''),
      maxLength('name', 'abc', 2),
      isEmail('email', 'sarah@nexora.io'),
      oneOf('status', 'bogus', ['active']),
    ]);

    expect(issues).toHaveLength(3);
    expect(issues.map((issue) => issue.path)).toEqual(['name', 'name', 'status']);
    expect(issues.every((issue) => issue.message.length > 0)).toBe(true);
  });
});
