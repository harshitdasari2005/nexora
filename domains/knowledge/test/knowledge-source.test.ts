/**
 * KnowledgeSource aggregate tests: creation with immutable scope, title/text
 * validation (no empty or oversized sources), and snapshot/hydrate.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import { InvalidKnowledgeValueError, KnowledgeSource } from '../src/index.js';

const TENANT = 'org_acme' as TenantId;
const WORKSPACE = 'wsp_engineering' as WorkspaceId;

function create(
  overrides: Partial<Parameters<typeof KnowledgeSource.create>[0]> = {},
  now = '2026-08-10T00:00:00.000Z',
): KnowledgeSource {
  return KnowledgeSource.create(
    {
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      documentId: 'doc_1',
      title: 'Mobile Banking Project Plan',
      text: 'The Mobile Banking project deadline is June 30.',
      version: 2,
      ...overrides,
    },
    now,
  );
}

describe('KnowledgeSource', () => {
  it('creates a source with immutable scope and its document reference', () => {
    const source = create();
    expect(source.tenantId).toBe(TENANT);
    expect(source.workspaceId).toBe(WORKSPACE);
    expect(source.documentId).toBe('doc_1');
    expect(source.title).toBe('Mobile Banking Project Plan');
    expect(source.version).toBe(2);
    expect(source.id).toMatch(/^ksrc_/);
  });

  it('rejects an empty title or empty text (no source is created)', () => {
    expect(() => create({ title: '   ' })).toThrow(InvalidKnowledgeValueError);
    expect(() => create({ text: '   ' })).toThrow(InvalidKnowledgeValueError);
    expect(() => create({ documentId: '' })).toThrow(InvalidKnowledgeValueError);
  });

  it('rejects an oversized title or text', () => {
    expect(() => create({ title: 'x'.repeat(201) })).toThrow(InvalidKnowledgeValueError);
    expect(() => create({ text: 'x'.repeat(200_001) })).toThrow(InvalidKnowledgeValueError);
  });

  it('round-trips through snapshot and hydrate', () => {
    const source = create();
    const restored = KnowledgeSource.hydrate(KnowledgeSource.snapshot(source));
    expect(restored.id).toBe(source.id);
    expect(restored.text).toBe(source.text);
    expect(restored.version).toBe(2);
    expect(restored.indexedAt).toBe(source.indexedAt);
  });
});
