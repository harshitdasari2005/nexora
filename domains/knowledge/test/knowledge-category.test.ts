/**
 * KnowledgeCategory aggregate tests (S18 Knowledge Base):
 *
 * - Categories are created active with immutable tenant + workspace scope.
 * - archive is terminal and idempotency-safe (double archive fails).
 * - Names are validated (non-empty, bounded).
 * - Snapshot/hydrate round-trips preserve identity and state.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import {
  InvalidKnowledgeValueError,
  KnowledgeCategory,
  KnowledgeCategoryId,
  type KnowledgeEventContext,
} from '../src/index.js';

const TENANT = 'org_acme' as TenantId;
const WORKSPACE = 'wsp_engineering' as WorkspaceId;

function context(): KnowledgeEventContext {
  return {
    actor: { kind: 'user', id: 'usr_alice' },
    correlationId: 'corr_1',
    organizationId: TENANT,
  };
}

describe('KnowledgeCategory', () => {
  it('creates an active category with immutable scope', () => {
    const category = KnowledgeCategory.create(
      { tenantId: TENANT, workspaceId: WORKSPACE, name: 'Policies' },
      context(),
      '2026-08-11T00:00:00.000Z',
    );
    expect(category.id).toMatch(/^kcat_/);
    expect(category.tenantId).toBe(TENANT);
    expect(category.workspaceId).toBe(WORKSPACE);
    expect(category.name).toBe('Policies');
    expect(category.archived).toBe(false);
    expect(category.isActive()).toBe(true);
    const events = category.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['knowledge.category.created']);
    expect(events[0]?.payload).toMatchObject({ name: 'Policies', status: 'active' });
  });

  it('rejects empty or oversized names', () => {
    expect(() =>
      KnowledgeCategory.create({ tenantId: TENANT, workspaceId: WORKSPACE, name: ' ' }, context()),
    ).toThrow(InvalidKnowledgeValueError);
    expect(() =>
      KnowledgeCategory.create(
        { tenantId: TENANT, workspaceId: WORKSPACE, name: 'x'.repeat(101) },
        context(),
      ),
    ).toThrow(InvalidKnowledgeValueError);
  });

  it('archives once; a second archive fails safely', () => {
    const category = KnowledgeCategory.create(
      { tenantId: TENANT, workspaceId: WORKSPACE, name: 'Policies' },
      context(),
    );
    category.pullDomainEvents();
    category.archive(context(), '2026-08-11T00:00:01.000Z');
    expect(category.archived).toBe(true);
    expect(category.isActive()).toBe(false);
    expect(category.pullDomainEvents().map((event) => event.type)).toEqual([
      'knowledge.category.archived',
    ]);
    expect(() => category.archive(context())).toThrow(InvalidKnowledgeValueError);
  });

  it('round-trips through snapshot and hydrate preserving identity and state', () => {
    const category = KnowledgeCategory.create(
      { tenantId: TENANT, workspaceId: WORKSPACE, name: 'SOPs' },
      context(),
    );
    const restored = KnowledgeCategory.hydrate(KnowledgeCategory.snapshot(category));
    expect(restored.id).toBe(category.id);
    expect(restored.name).toBe('SOPs');
    expect(restored.archived).toBe(false);
    expect(restored.createdAt).toBe(category.createdAt);
  });

  it('validates the category id factory', () => {
    expect(KnowledgeCategoryId.create()).toMatch(/^kcat_/);
    expect(() => KnowledgeCategoryId.from('')).toThrow(InvalidKnowledgeValueError);
    expect(() => KnowledgeCategoryId.from('art_123')).toThrow(InvalidKnowledgeValueError);
  });
});
