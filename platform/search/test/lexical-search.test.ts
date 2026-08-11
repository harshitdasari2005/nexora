/**
 * Search platform tests: deterministic lexical scoring + the in-memory
 * scope-filtered index. The security property under test: a query can NEVER
 * return an entry outside the requested tenant + workspace — the scope
 * filter is the FIRST gate, before any scoring.
 */

import { describe, expect, it } from 'vitest';

import { InMemorySearchIndex, rankEntries, scoreEntry, tokenize } from '../src/index.js';
import type { SearchIndexEntry } from '../src/index.js';

const TENANT = 'org_acme';
const WORKSPACE_A = 'wsp_a';
const WORKSPACE_B = 'wsp_b';

function entry(overrides: Partial<SearchIndexEntry> = {}): SearchIndexEntry {
  return {
    id: overrides.id ?? 'src_1',
    tenantId: overrides.tenantId ?? TENANT,
    workspaceId: overrides.workspaceId ?? WORKSPACE_A,
    scopeId: overrides.scopeId ?? 'doc_1',
    kind: 'document',
    title: overrides.title ?? 'Mobile Banking Project Plan',
    text: overrides.text ?? 'The Mobile Banking project deadline is June 30. The budget is 1.2M.',
    version: overrides.version ?? 1,
    indexedAt: overrides.indexedAt ?? '2026-08-10T00:00:00.000Z',
  };
}

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric characters', () => {
    expect(tokenize('Mobile Banking 2026!')).toEqual(['mobile', 'banking', '2026']);
  });

  it('drops stop words', () => {
    expect(tokenize('What does the deadline say')).toEqual(['deadline']);
  });
});

describe('scoreEntry', () => {
  it('scores a title match above a body-only match', () => {
    const tokens = tokenize('mobile banking deadline');
    const titleMatch = scoreEntry(
      entry({ title: 'Mobile Banking Plan', text: 'unrelated body text' }),
      tokens,
    );
    const bodyMatch = scoreEntry(
      entry({ title: 'Unrelated', text: 'the mobile banking project deadline is june' }),
      tokens,
    );
    expect(titleMatch).toBeGreaterThan(bodyMatch);
    expect(titleMatch).toBeGreaterThan(0);
  });

  it('returns 0 when nothing matches', () => {
    expect(scoreEntry(entry(), tokenize('penguin migration'))).toBe(0);
  });

  it('returns 0 for an empty query', () => {
    expect(scoreEntry(entry(), tokenize(''))).toBe(0);
  });
});

describe('rankEntries', () => {
  it('ranks by score desc and bounds the result', () => {
    const exact = entry({ id: 'src_exact', title: 'Deadline Notes', text: 'deadline deadline' });
    const partial = entry({
      id: 'src_partial',
      title: 'Budget',
      text: 'the project budget is 1.2M',
    });
    const ranked = rankEntries([partial, exact], tokenize('deadline'), 1);
    expect(ranked.map((e) => e.id)).toEqual(['src_exact']);
  });
});

describe('InMemorySearchIndex', () => {
  it('indexes and retrieves an authorized document (exact + ranked)', async () => {
    const index = new InMemorySearchIndex();
    await index.put(entry());
    await index.put(
      entry({ id: 'src_2', scopeId: 'doc_2', title: 'Budget Notes', text: 'unrelated' }),
    );

    const results = await index.query({
      tenantId: TENANT,
      workspaceId: WORKSPACE_A,
      query: 'mobile banking project deadline',
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.id).toBe('src_1');
  });

  it('NEVER returns a cross-workspace document (authorization-first)', async () => {
    const index = new InMemorySearchIndex();
    await index.put(entry()); // workspace A
    await index.put(entry({ id: 'src_b', scopeId: 'doc_b', workspaceId: WORKSPACE_B }));

    const results = await index.query({
      tenantId: TENANT,
      workspaceId: WORKSPACE_A,
      query: 'mobile banking deadline',
    });
    expect(results.map((e) => e.id)).toEqual(['src_1']);
  });

  it('NEVER returns a cross-tenant document', async () => {
    const index = new InMemorySearchIndex();
    await index.put(entry());
    await index.put(entry({ id: 'src_alien', scopeId: 'doc_alien', tenantId: 'org_alien' }));

    const results = await index.query({
      tenantId: TENANT,
      workspaceId: WORKSPACE_A,
      query: 'mobile banking deadline',
    });
    expect(results.map((e) => e.id)).toEqual(['src_1']);
  });

  it('excludes scopes the caller cannot access (e.g. archived)', async () => {
    const index = new InMemorySearchIndex();
    await index.put(entry({ id: 'src_1', scopeId: 'doc_1' }));
    await index.put(
      entry({ id: 'src_2', scopeId: 'doc_2', title: 'Deadline', text: 'deadline june' }),
    );

    const results = await index.query({
      tenantId: TENANT,
      workspaceId: WORKSPACE_A,
      query: 'deadline',
      excludeScopeIds: ['doc_2'],
    });
    expect(results.map((e) => e.scopeId)).toEqual(['doc_1']);
  });

  it('bounds the result count', async () => {
    const index = new InMemorySearchIndex();
    for (let i = 1; i <= 10; i += 1) {
      await index.put(
        entry({
          id: `src_${i}`,
          scopeId: `doc_${i}`,
          title: `Deadline Note ${i}`,
          text: 'deadline june 30',
        }),
      );
    }
    const results = await index.query({
      tenantId: TENANT,
      workspaceId: WORKSPACE_A,
      query: 'deadline',
      limit: 3,
    });
    expect(results.length).toBe(3);
  });

  it('replacing an entry updates the searchable version (stale never answers)', async () => {
    const index = new InMemorySearchIndex();
    await index.put(entry({ version: 1, text: 'the deadline is June 30' }));
    await index.put(entry({ version: 2, text: 'the deadline is now December 15' }));

    const results = await index.query({
      tenantId: TENANT,
      workspaceId: WORKSPACE_A,
      query: 'december',
    });
    expect(results.map((e) => e.version)).toEqual([2]);
  });

  it('removeByScope takes an archived document out of the index', async () => {
    const index = new InMemorySearchIndex();
    await index.put(entry());
    await index.removeByScope('doc_1', TENANT);
    const results = await index.query({
      tenantId: TENANT,
      workspaceId: WORKSPACE_A,
      query: 'mobile banking deadline',
    });
    expect(results).toEqual([]);
  });
});
