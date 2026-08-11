/**
 * Client-side form validation tests (pure functions; the server stays the
 * authoritative validator).
 */

import { describe, expect, it } from 'vitest';

import { slugify, validateOnboardingForm } from '../src/lib/validation.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Acme Inc.')).toBe('acme-inc');
    expect(slugify('  Engineering Team  ')).toBe('engineering-team');
  });

  it('strips leading/trailing separators', () => {
    expect(slugify('--Acme--')).toBe('acme');
  });
});

describe('validateOnboardingForm', () => {
  const valid = { name: 'Acme', slug: 'acme', type: 'startup' };

  it('accepts a valid form', () => {
    expect(validateOnboardingForm(valid)).toEqual([]);
  });

  it('requires a name', () => {
    const issues = validateOnboardingForm({ ...valid, name: '  ' });
    expect(issues.some((issue) => issue.field === 'name')).toBe(true);
  });

  it('rejects an invalid slug', () => {
    const issues = validateOnboardingForm({ ...valid, slug: 'Bad Slug!' });
    expect(issues.some((issue) => issue.field === 'slug')).toBe(true);
  });

  it('requires a type', () => {
    const issues = validateOnboardingForm({ ...valid, type: '' });
    expect(issues.some((issue) => issue.field === 'type')).toBe(true);
  });

  it('collects multiple issues at once', () => {
    const issues = validateOnboardingForm({ name: '', slug: '!!', type: '' });
    expect(issues).toHaveLength(3);
  });
});
