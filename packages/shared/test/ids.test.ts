import { describe, expect, it } from 'vitest';

import {
  correlationId,
  idPrefix,
  isValidUuid,
  prefixedId,
  requestId,
  uuid,
} from '../src/ids/index.js';

describe('ids', () => {
  it('generates valid UUID v4 values', () => {
    const value = uuid();

    expect(isValidUuid(value)).toBe(true);
    expect(value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates unique values', () => {
    const first = uuid();
    const second = uuid();

    expect(first).not.toBe(second);
  });

  it('rejects malformed UUIDs', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('')).toBe(false);
    expect(isValidUuid('9f8b1c2d-1111-4111-8111-11111111111g')).toBe(false);
  });

  it('creates prefixed entity ids that embed a valid UUID', () => {
    const id = prefixedId('emp');

    expect(id.startsWith('emp_')).toBe(true);
    expect(isValidUuid(id.slice(4))).toBe(true);
  });

  it('rejects invalid prefixes', () => {
    expect(() => prefixedId('')).toThrow(TypeError);
    expect(() => prefixedId('EMP')).toThrow(TypeError);
    expect(() => prefixedId('has space')).toThrow(TypeError);
  });

  it('extracts the prefix from a prefixed id', () => {
    expect(idPrefix(prefixedId('prj'))).toBe('prj');
    expect(idPrefix('raw-string')).toBeNull();
    expect(idPrefix(`${prefixedId('evt')}extra`)).toBeNull();
  });

  it('generates correlation and request ids', () => {
    expect(correlationId().startsWith('corr_')).toBe(true);
    expect(requestId().startsWith('req_')).toBe(true);
    expect(correlationId()).not.toBe(correlationId());
  });
});
