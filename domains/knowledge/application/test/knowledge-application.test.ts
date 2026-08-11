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
import type { KnowledgeSource, KnowledgeSourceRepository } from '@nexora/domain-knowledge';

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

function buildService(
  options: {
    sources?: InMemoryKnowledgeSourceRepository;
    searchIndex?: SearchIndexPort;
    publisher?: EventPublisher & { published: readonly EventEnvelope[] };
  } = {},
) {
  const sources = options.sources ?? new InMemoryKnowledgeSourceRepository();
  const searchIndex = options.searchIndex ?? new InMemorySearchIndex();
  const publisher = options.publisher ?? recordingPublisher();
  const service = new KnowledgeApplicationService({ sources, searchIndex, publisher });
  return { service, sources, searchIndex, publisher };
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
