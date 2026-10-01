import { describe, expect, it } from 'vitest';

import { deterministicId, fingerprint, stableStringify } from '../src/ids.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deterministicId', () => {
  it('is stable for the same name and distinct across names/prefixes', () => {
    expect(deterministicId('org', 'world/aurora')).toBe(deterministicId('org', 'world/aurora'));
    expect(deterministicId('org', 'world/aurora')).not.toBe(
      deterministicId('org', 'world/borealis'),
    );
    expect(deterministicId('org', 'world/aurora')).not.toBe(deterministicId('wsp', 'world/aurora'));
  });

  it('keeps the platform `<prefix>_<uuid-v4>` shape', () => {
    for (const name of ['a', 'b/c', 'nexora-enterprise-v1/meera', 'x'.repeat(200)]) {
      const id = deterministicId('usr', name);
      expect(id.startsWith('usr_')).toBe(true);
      expect(id.slice(4)).toMatch(UUID_V4);
    }
  });
});

describe('fingerprint', () => {
  it('ignores object key order and undefined fields', () => {
    expect(fingerprint({ a: 1, b: [1, { c: 2, d: undefined }] })).toBe(
      fingerprint({ b: [1, { c: 2 }], a: 1 }),
    );
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('changes when content changes', () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});
