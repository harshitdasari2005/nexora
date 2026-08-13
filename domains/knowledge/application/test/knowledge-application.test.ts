/**
 * Knowledge application tests: indexing (persist + search put + event),
 * BR-7 permission-filtered retrieval (cross-workspace / cross-tenant sources
 * never returned), version replacement (stale entries never answer), and
 * removal on archive.
 */

import { describe, expect, it, vi } from 'vitest';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import {
  InMemorySearchIndex,
  type SearchIndexEntry,
  type SearchIndexPort,
} from '@nexora/module-search';
import {
  KnowledgeDomainService,
  type KnowledgeArticle as KnowledgeArticleType,
  type KnowledgeArticleRepository,
  type KnowledgeCategory as KnowledgeCategoryType,
  type KnowledgeCategoryRepository,
  type KnowledgeSource,
  type KnowledgeSourceRepository,
} from '@nexora/domain-knowledge';

import {
  KnowledgeApplicationService,
  buildSnippet,
  type IndexDocumentCommand,
} from '../src/index.js';

const TENANT = 'org_acme' as TenantId;
const WORKSPACE = 'wsp_engineering' as WorkspaceId;
const WORKSPACE_B = 'wsp_other' as WorkspaceId;

/** An in-memory {@link KnowledgeSourceRepository} (matches API fakes). */
class InMemoryKnowledgeSourceRepository implements KnowledgeSourceRepository {
  readonly sources = new Map<string, KnowledgeSource>();

  async findById(id: string): Promise<KnowledgeSource | undefined> {
    return this.sources.get(id);
  }

  async findByDocument(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    documentId: string,
  ): Promise<KnowledgeSource | undefined> {
    for (const source of this.sources.values()) {
      if (
        source.tenantId === tenantId &&
        source.workspaceId === workspaceId &&
        source.documentId === documentId
      ) {
        return source;
      }
    }
    return undefined;
  }

  async listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    limit?: number,
  ): Promise<readonly KnowledgeSource[]> {
    return [...this.sources.values()]
      .filter((source) => source.tenantId === tenantId && source.workspaceId === workspaceId)
      .sort((a, b) => b.indexedAt.localeCompare(a.indexedAt))
      .slice(0, limit ?? 100);
  }

  async save(source: KnowledgeSource): Promise<void> {
    this.sources.set(source.id, source);
  }

  async removeByDocument(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    documentId: string,
  ): Promise<void> {
    for (const [id, source] of this.sources) {
      if (
        source.tenantId === tenantId &&
        source.workspaceId === workspaceId &&
        source.documentId === documentId
      ) {
        this.sources.delete(id);
      }
    }
  }
}

function recordingPublisher(): EventPublisher & { published: readonly EventEnvelope[] } {
  const published: EventEnvelope[] = [];
  return {
    published,
    publish: vi.fn(async (events: readonly EventEnvelope[]) => {
      published.push(...events);
    }),
  } as unknown as EventPublisher & { published: readonly EventEnvelope[] };
}

/** An in-memory {@link KnowledgeArticleRepository}. */
class InMemoryKnowledgeArticleRepository implements KnowledgeArticleRepository {
  readonly articles = new Map<string, KnowledgeArticleType>();

  async findById(id: string): Promise<KnowledgeArticleType | undefined> {
    return this.articles.get(id);
  }

  async listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly KnowledgeArticleType[]> {
    return [...this.articles.values()]
      .filter((article) => article.tenantId === tenantId && article.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(article: KnowledgeArticleType): Promise<void> {
    this.articles.set(article.id, article);
  }
}

/** An in-memory {@link KnowledgeCategoryRepository}. */
class InMemoryKnowledgeCategoryRepository implements KnowledgeCategoryRepository {
  readonly categories = new Map<string, KnowledgeCategoryType>();

  async findById(id: string): Promise<KnowledgeCategoryType | undefined> {
    return this.categories.get(id);
  }

  async listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly KnowledgeCategoryType[]> {
    return [...this.categories.values()]
      .filter((category) => category.tenantId === tenantId && category.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async existsByName(tenantId: TenantId, workspaceId: WorkspaceId, name: string): Promise<boolean> {
    return [...this.categories.values()].some(
      (category) =>
        category.tenantId === tenantId &&
        category.workspaceId === workspaceId &&
        category.name === name,
    );
  }

  async save(category: KnowledgeCategoryType): Promise<void> {
    this.categories.set(category.id, category);
  }
}

function buildService(
  options: {
    sources?: InMemoryKnowledgeSourceRepository;
    searchIndex?: SearchIndexPort;
    publisher?: EventPublisher & { published: readonly EventEnvelope[] };
    articles?: InMemoryKnowledgeArticleRepository;
    categories?: InMemoryKnowledgeCategoryRepository;
  } = {},
) {
  const sources = options.sources ?? new InMemoryKnowledgeSourceRepository();
  const searchIndex = options.searchIndex ?? new InMemorySearchIndex();
  const publisher = options.publisher ?? recordingPublisher();
  const articles = options.articles ?? new InMemoryKnowledgeArticleRepository();
  const categories = options.categories ?? new InMemoryKnowledgeCategoryRepository();
  const knowledgeService = new KnowledgeDomainService({ articles, categories });
  const service = new KnowledgeApplicationService({
    sources,
    searchIndex,
    publisher,
    knowledgeService,
  });
  return { service, sources, searchIndex, publisher, articles, categories };
}

/** Seeds an active category and a published article (freshness helpers). */
async function seedPublishedArticle(
  service: KnowledgeApplicationService,
  categories: InMemoryKnowledgeCategoryRepository,
  overrides: { tenantId?: TenantId; workspaceId?: WorkspaceId; categoryTenantId?: TenantId } = {},
): Promise<{ articleId: string; categoryId?: string }> {
  const tenantId = overrides.tenantId ?? TENANT;
  const workspaceId = overrides.workspaceId ?? WORKSPACE;
  const createdCategory = await service.createCategory({
    tenantId,
    workspaceId,
    actorId: 'usr_alice' as never,
    name: 'Policies',
    correlationId: 'corr_cat',
  });
  if (!createdCategory.ok) throw new Error('category seed failed');
  categories.categories.set(createdCategory.value.category.id, createdCategory.value.category);

  const created = await service.createArticle({
    tenantId,
    workspaceId,
    actorId: 'usr_alice' as never,
    title: 'Leave Policy',
    body: 'Employees may take 25 days of leave per year. The deadline to submit is June 30.',
    categoryId: createdCategory.value.category.id,
    correlationId: 'corr_art',
  });
  if (!created.ok) throw new Error('article seed failed');
  const published = await service.publishArticle({
    tenantId,
    workspaceId,
    actorId: 'usr_alice' as never,
    articleId: created.value.article.id,
    correlationId: 'corr_pub',
  });
  if (!published.ok) throw new Error('article publish failed');
  await service.indexArticle({
    tenantId,
    workspaceId,
    articleId: published.value.article.id,
    title: published.value.article.title,
    text: published.value.article.body,
    version: published.value.article.contentVersion,
  });
  return { articleId: published.value.article.id, categoryId: createdCategory.value.category.id };
}

function indexCommand(overrides: Partial<IndexDocumentCommand> = {}): IndexDocumentCommand {
  return {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    documentId: 'doc_1',
    title: 'Mobile Banking Project Plan',
    text: 'The Mobile Banking project deadline is June 30. The budget is 1.2M.',
    version: 2,
    context: { actorId: 'usr_alice', correlationId: 'corr_1' },
    ...overrides,
  };
}

describe('KnowledgeApplicationService.indexDocument', () => {
  it('persists the source, indexes it, and publishes knowledge.indexed', async () => {
    const { service, sources, searchIndex, publisher } = buildService();
    const result = await service.indexDocument(indexCommand());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sources.sources.size).toBe(1);
    const entries = [
      ...(searchIndex as InMemorySearchIndex).entries.values(),
    ] as SearchIndexEntry[];
    expect(entries.length).toBe(1);
    expect(entries[0]?.scopeId).toBe('doc_1');
    expect(publisher.published.map((event) => event.type)).toEqual(['knowledge.indexed']);
    expect(publisher.published[0]?.payload).toMatchObject({
      documentId: 'doc_1',
      workspaceId: WORKSPACE,
      version: 2,
    });
  });

  it('rejects empty or oversized indexed text (never indexes garbage)', async () => {
    const { service } = buildService();
    const empty = await service.indexDocument(indexCommand({ text: '   ' }));
    expect(empty.ok).toBe(false);
    const oversized = await service.indexDocument(indexCommand({ text: 'x'.repeat(200_001) }));
    expect(oversized.ok).toBe(false);
  });
});

describe('KnowledgeApplicationService.retrieve (BR-7 permission-filtered)', () => {
  async function seedThreeWorkspaces(service: KnowledgeApplicationService): Promise<void> {
    // doc_1 in WORKSPACE, doc_alien in WORKSPACE_B, doc_othertenant in another tenant.
    await service.indexDocument(indexCommand());
    await service.indexDocument(
      indexCommand({
        documentId: 'doc_alien',
        title: 'Private HR Document',
        text: 'secret payroll details for Mobile Banking',
        workspaceId: WORKSPACE_B,
      }),
    );
    await service.indexDocument(
      indexCommand({
        documentId: 'doc_othertenant',
        title: 'Other Tenant Plan',
        text: 'Mobile Banking deadline in another company',
        tenantId: 'org_alien' as TenantId,
      }),
    );
  }

  it('returns only the references the caller is authorized to see', async () => {
    const { service } = buildService();
    await seedThreeWorkspaces(service);

    const result = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      query: 'Mobile Banking deadline',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.references.map((reference) => reference.documentId);
    expect(ids).toEqual(['doc_1']); // the private HR doc and other-tenant doc never appear
    expect(result.value.references[0]?.title).toBe('Mobile Banking Project Plan');
    expect(result.value.references[0]?.snippet).toContain('June 30');
  });

  it('a cross-workspace question finds nothing (no leak to workspace B)', async () => {
    const { service } = buildService();
    await seedThreeWorkspaces(service);

    const result = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE_B,
      query: 'secret payroll Mobile Banking',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.references.map((reference) => reference.documentId)).toEqual(['doc_alien']);
  });

  it('an unrelated question returns zero references (nothing fabricated)', async () => {
    const { service } = buildService();
    await seedThreeWorkspaces(service);

    const result = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      query: 'penguin migration routes',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.references).toEqual([]);
  });

  it('bounds the result count', async () => {
    const { service } = buildService();
    for (let i = 1; i <= 6; i += 1) {
      await service.indexDocument(
        indexCommand({
          documentId: `doc_${i}`,
          title: `Deadline Note ${i}`,
          text: 'deadline june 30',
        }),
      );
    }
    const result = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      query: 'deadline',
      limit: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.references.length).toBe(3);
  });
});

describe('version replacement + removal', () => {
  it('re-indexing a document replaces the searchable version (stale never answers)', async () => {
    const { service, searchIndex } = buildService();
    await service.indexDocument(indexCommand({ version: 1, text: 'the deadline is June 30' }));
    await service.indexDocument(
      indexCommand({ version: 2, text: 'the deadline is now December 15' }),
    );

    const result = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      query: 'december',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.references[0]?.snippet).toContain('December 15');
    const entries = [...(searchIndex as InMemorySearchIndex).entries.values()];
    expect(entries.length).toBe(1); // replaced, not duplicated
  });

  it('removes a document from both the persisted sources and the search index', async () => {
    const { service, sources, searchIndex } = buildService();
    await service.indexDocument(indexCommand());
    expect(sources.sources.size).toBe(1);

    const removed = await service.removeDocument({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      documentId: 'doc_1',
      context: { actorId: 'usr_alice', correlationId: 'corr_2' },
    });
    expect(removed.ok).toBe(true);
    expect(sources.sources.size).toBe(0);
    expect((searchIndex as InMemorySearchIndex).entries.size).toBe(0);

    const result = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      query: 'Mobile Banking deadline',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.references).toEqual([]);
  });
});

describe('buildSnippet', () => {
  it('builds a bounded snippet around the first match', () => {
    const snippet = buildSnippet('The Mobile Banking project deadline is June 30.', 'deadline', 40);
    expect(snippet).toContain('June 30');
    expect(snippet.length).toBeLessThanOrEqual(43); // 40 + ellipses
  });
});

describe('KnowledgeApplicationService articles (S18 Knowledge Base)', () => {
  it('creates an article as a draft and never indexes it', async () => {
    const { service, searchIndex, publisher } = buildService();
    const created = await service.createArticle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      title: 'Leave Policy',
      body: 'Employees may take 25 days of leave per year.',
      correlationId: 'corr_1',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.article.status.value).toBe('draft');
    expect(created.value.article.contentVersion).toBe(1);
    // A draft is NEVER in the search corpus.
    expect((searchIndex as InMemorySearchIndex).entries.size).toBe(0);
    expect(publisher.published.map((event) => event.type)).toEqual(['knowledge.article.created']);
  });

  it('rejects a category that does not belong to the trusted scope', async () => {
    const { service } = buildService();
    const created = await service.createArticle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      title: 'Leave Policy',
      body: 'Body.',
      categoryId: 'kcat_99999999-9999-4999-8999-999999999999',
      correlationId: 'corr_1',
    });
    expect(created.ok).toBe(false);
  });

  it('publishing indexes the article with kind=article and version=contentVersion', async () => {
    const { service, searchIndex, publisher } = buildService();
    const created = await service.createArticle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      title: 'Leave Policy',
      body: 'Employees may take 25 days of leave per year.',
      correlationId: 'corr_1',
    });
    if (!created.ok) return;
    const published = await service.publishArticle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      articleId: created.value.article.id,
      correlationId: 'corr_2',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    await service.indexArticle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      articleId: published.value.article.id,
      title: published.value.article.title,
      text: published.value.article.body,
      version: published.value.article.contentVersion,
    });
    const entries = [...(searchIndex as InMemorySearchIndex).entries.values()];
    expect(entries.length).toBe(1);
    expect(entries[0]?.kind).toBe('article');
    expect(entries[0]?.scopeId).toBe(published.value.article.id);
    expect(entries[0]?.version).toBe(1);
    expect(publisher.published.map((event) => event.type)).toContain('knowledge.article.published');
  });

  it('a draft is never retrieved; a published article is retrieved with kind + version citation', async () => {
    const { service, categories } = buildService();
    await seedPublishedArticle(service, categories);
    const draft = await service.createArticle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      title: 'Draft Secret',
      body: 'This draft must never answer retrieval queries about leave.',
      correlationId: 'corr_draft',
    });
    if (!draft.ok) return;

    const result = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      query: 'leave policy deadline',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.references.length).toBe(1);
    const reference = result.value.references[0];
    expect(reference?.kind).toBe('article');
    expect(reference?.version).toBe(1);
    expect(reference?.title).toBe('Leave Policy');
  });

  it('editing a published article bumps the version and the re-indexed content replaces the old', async () => {
    const { service, categories } = buildService();
    const { articleId } = await seedPublishedArticle(service, categories);

    const updated = await service.updateArticle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      articleId,
      title: 'Leave Policy',
      body: 'Employees may now take 30 days of leave per year. The deadline to submit is December 15.',
      correlationId: 'corr_upd',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.article.contentVersion).toBe(2);
    await service.indexArticle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      articleId,
      title: updated.value.article.title,
      text: updated.value.article.body,
      version: updated.value.article.contentVersion,
    });

    // New content answers; old content never leaks.
    const fresh = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      query: 'december fifteen',
    });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.value.references[0]?.snippet).toContain('December 15');
    expect(fresh.value.references[0]?.version).toBe(2);

    const stale = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      query: '25',
    });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.value.references).toEqual([]); // the old '25 days' content never leaks
  });

  it('archiving removes the article from the corpus — an archived article never answers', async () => {
    const { service, categories, searchIndex } = buildService();
    const { articleId } = await seedPublishedArticle(service, categories);

    const archived = await service.archiveArticle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      articleId,
      correlationId: 'corr_arch',
    });
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.value.article.status.value).toBe('archived');
    await service.removeArticleIndex({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      articleId,
    });
    expect((searchIndex as InMemorySearchIndex).entries.size).toBe(0);

    const result = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      query: 'leave policy',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.references).toEqual([]);
  });

  it('a foreign article id resolves to NOT FOUND (workspace isolation)', async () => {
    const { service } = buildService();
    const got = await service.getArticle(
      TENANT,
      WORKSPACE,
      'art_00000000-0000-4000-8000-000000000000',
    );
    expect(got.ok).toBe(false);
    const updated = await service.updateArticle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      articleId: 'art_00000000-0000-4000-8000-000000000000',
      title: 'x',
      body: 'y',
      correlationId: 'corr_x',
    });
    expect(updated.ok).toBe(false);
    const published = await service.publishArticle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      articleId: 'art_00000000-0000-4000-8000-000000000000',
      correlationId: 'corr_x',
    });
    expect(published.ok).toBe(false);
  });

  it('a cross-workspace article is invisible (get + retrieval leak nothing)', async () => {
    const { service, categories } = buildService();
    await seedPublishedArticle(service, categories, { workspaceId: WORKSPACE_B });

    const got = await service.getArticle(TENANT, WORKSPACE, 'art_none');
    expect(got.ok).toBe(false);
    const result = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      query: 'leave policy',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.references).toEqual([]);
  });

  it('documents and articles coexist in retrieval with correct kind citations', async () => {
    const { service, categories } = buildService();
    await service.indexDocument(indexCommand()); // kind=document
    await seedPublishedArticle(service, categories); // kind=article

    const result = await service.retrieve({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      query: 'leave mobile banking',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.references.length).toBe(2);
    const kinds = result.value.references.map((reference) => reference.kind).sort();
    expect(kinds).toEqual(['article', 'document']);
  });
});

describe('KnowledgeApplicationService categories (S18 Knowledge Base)', () => {
  it('creates a category and lists the workspace categories', async () => {
    const { service } = buildService();
    const created = await service.createCategory({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      name: 'Policies',
      correlationId: 'corr_1',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.category.name).toBe('Policies');
    expect(created.value.category.archived).toBe(false);

    const listed = await service.listCategoriesByWorkspace(TENANT, WORKSPACE);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((category) => category.name)).toEqual(['Policies']);
  });

  it('rejects a duplicate category name in the same workspace with CONFLICT (no leaked 500)', async () => {
    const { service } = buildService();
    const first = await service.createCategory({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      name: 'Policies',
      correlationId: 'corr_1',
    });
    expect(first.ok).toBe(true);

    const duplicate = await service.createCategory({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      name: 'Policies',
      correlationId: 'corr_2',
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe('CONFLICT');
      expect(duplicate.error.message).toContain('already exists');
    }
    // Zero mutation: only the first category exists.
    const listed = await service.listCategoriesByWorkspace(TENANT, WORKSPACE);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.value).toHaveLength(1);
    }
  });

  it('allows the same category name in a DIFFERENT workspace (scope-bound uniqueness)', async () => {
    const { service } = buildService();
    const inA = await service.createCategory({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      actorId: 'usr_alice' as never,
      name: 'Policies',
      correlationId: 'corr_1',
    });
    expect(inA.ok).toBe(true);
    const inB = await service.createCategory({
      tenantId: TENANT,
      workspaceId: WORKSPACE_B,
      actorId: 'usr_alice' as never,
      name: 'Policies',
      correlationId: 'corr_2',
    });
    expect(inB.ok).toBe(true);
  });
});
