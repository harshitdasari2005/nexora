/**
 * KnowledgeArticle aggregate tests (S18 Knowledge Base):
 *
 * - Articles start as drafts (never indexed).
 * - contentVersion is monotonic (1 on create, +1 per content update).
 * - Lifecycle: draft → published → archived (terminal); only published is
 *   retrievable.
 * - Editing a published article keeps it published and bumps the version.
 * - Archived articles reject content updates and every transition.
 * - Snapshot/hydrate round-trips preserve identity and state.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import {
  KnowledgeArticle,
  KnowledgeArticleId,
  InvalidKnowledgeValueError,
  type KnowledgeEventContext,
} from '../src/index.js';

const TENANT = 'org_acme' as TenantId;
const WORKSPACE = 'wsp_engineering' as WorkspaceId;
const AUTHOR = 'usr_alice' as UserId;

function context(): KnowledgeEventContext {
  return {
    actor: { kind: 'user', id: AUTHOR },
    correlationId: 'corr_1',
    organizationId: TENANT,
  };
}

function articleInput(overrides: Partial<Parameters<typeof KnowledgeArticle.create>[0]> = {}) {
  return {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    title: 'Leave Policy',
    body: 'Employees may take 25 days of leave per year.',
    author: AUTHOR,
    ...overrides,
  };
}

describe('KnowledgeArticle lifecycle', () => {
  it('creates a draft article with contentVersion 1 and immutable scope', () => {
    const article = KnowledgeArticle.create(articleInput(), context(), '2026-08-11T00:00:00.000Z');
    expect(article.id).toMatch(/^art_/);
    expect(article.tenantId).toBe(TENANT);
    expect(article.workspaceId).toBe(WORKSPACE);
    expect(article.title).toBe('Leave Policy');
    expect(article.status.value).toBe('draft');
    expect(article.contentVersion).toBe(1);
    expect(article.isRetrievable()).toBe(false);
    const events = article.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['knowledge.article.created']);
    expect(events[0]?.payload).toMatchObject({ title: 'Leave Policy', status: 'draft' });
  });

  it('validates title and body on creation', () => {
    expect(() => KnowledgeArticle.create(articleInput({ title: ' ' }), context())).toThrow(
      InvalidKnowledgeValueError,
    );
    expect(() => KnowledgeArticle.create(articleInput({ body: '' }), context())).toThrow(
      InvalidKnowledgeValueError,
    );
    expect(() =>
      KnowledgeArticle.create(articleInput({ title: 'x'.repeat(201) }), context()),
    ).toThrow(InvalidKnowledgeValueError);
    expect(() =>
      KnowledgeArticle.create(articleInput({ body: 'x'.repeat(100_001) }), context()),
    ).toThrow(InvalidKnowledgeValueError);
  });

  it('updateContent bumps the monotonic contentVersion and emits article.updated', () => {
    const article = KnowledgeArticle.create(articleInput(), context());
    article.pullDomainEvents();
    article.updateContent(
      { title: 'Leave Policy v2', body: 'Employees may take 30 days of leave per year.' },
      context(),
      '2026-08-11T00:00:01.000Z',
    );
    expect(article.title).toBe('Leave Policy v2');
    expect(article.contentVersion).toBe(2);
    const events = article.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['knowledge.article.updated']);
    expect(events[0]?.payload).toMatchObject({ version: 2, status: 'draft' });
  });

  it('publish transitions draft → published and emits article.published', () => {
    const article = KnowledgeArticle.create(articleInput(), context());
    article.pullDomainEvents();
    article.publish(context(), '2026-08-11T00:00:02.000Z');
    expect(article.status.value).toBe('published');
    expect(article.isRetrievable()).toBe(true);
    const events = article.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['knowledge.article.published']);
    expect(events[0]?.payload).toMatchObject({ version: 1 });
  });

  it('a published article can be edited; contentVersion keeps bumping', () => {
    const article = KnowledgeArticle.create(articleInput(), context());
    article.publish(context());
    article.pullDomainEvents();
    article.updateContent(
      { title: 'Leave Policy', body: 'Employees may take 28 days of leave per year.' },
      context(),
    );
    expect(article.status.value).toBe('published');
    expect(article.contentVersion).toBe(2);
    expect(article.isRetrievable()).toBe(true);
  });

  it('publish only from draft; publishing a published article fails safely', () => {
    const article = KnowledgeArticle.create(articleInput(), context());
    article.publish(context());
    article.pullDomainEvents();
    expect(() => article.publish(context())).toThrow(InvalidKnowledgeValueError);
    expect(article.status.value).toBe('published');
    expect(article.pullDomainEvents()).toEqual([]);
  });

  it('archive is terminal: no updates, no transitions, leaves the corpus', () => {
    const article = KnowledgeArticle.create(articleInput(), context());
    article.publish(context());
    article.pullDomainEvents();
    article.archive(context(), '2026-08-11T00:00:03.000Z');
    expect(article.status.value).toBe('archived');
    expect(article.isRetrievable()).toBe(false);
    expect(article.pullDomainEvents().map((event) => event.type)).toEqual([
      'knowledge.article.archived',
    ]);
    expect(() => article.updateContent({ title: 'x', body: 'y' }, context())).toThrow(
      InvalidKnowledgeValueError,
    );
    expect(() => article.publish(context())).toThrow(InvalidKnowledgeValueError);
    expect(() => article.archive(context())).toThrow(InvalidKnowledgeValueError);
  });

  it('a draft can be archived directly (never indexed)', () => {
    const article = KnowledgeArticle.create(articleInput(), context());
    article.pullDomainEvents();
    article.archive(context());
    expect(article.status.value).toBe('archived');
    expect(article.pullDomainEvents().map((event) => event.type)).toEqual([
      'knowledge.article.archived',
    ]);
  });

  it('round-trips through snapshot and hydrate preserving identity and state', () => {
    const article = KnowledgeArticle.create(articleInput(), context());
    article.updateContent(
      { title: 'Leave Policy', body: 'Updated body.', categoryId: undefined },
      context(),
    );
    article.publish(context());
    const restored = KnowledgeArticle.hydrate(KnowledgeArticle.snapshot(article));
    expect(restored.id).toBe(article.id);
    expect(restored.title).toBe('Leave Policy');
    expect(restored.body).toBe('Updated body.');
    expect(restored.status.value).toBe('published');
    expect(restored.contentVersion).toBe(2);
    expect(restored.author).toBe(AUTHOR);
    expect(restored.createdAt).toBe(article.createdAt);
    expect(restored.updatedAt).toBe(article.updatedAt);
    expect(restored.version).toBe(article.version);
    expect(restored.pullDomainEvents()).toEqual([]);
  });

  it('validates the article id factory', () => {
    expect(KnowledgeArticleId.create()).toMatch(/^art_/);
    expect(() => KnowledgeArticleId.from('')).toThrow(InvalidKnowledgeValueError);
    expect(() => KnowledgeArticleId.from('doc_123')).toThrow(InvalidKnowledgeValueError);
  });

  it('an optional category id is accepted and validated', () => {
    const article = KnowledgeArticle.create(
      articleInput({ categoryId: 'kcat_11111111-1111-4111-8111-111111111111' as never }),
      context(),
    );
    expect(article.categoryId).toBe('kcat_11111111-1111-4111-8111-111111111111');
  });
});
