/**
 * @nexora/persistence — knowledge repositories.
 *
 * Two implementations over the `knowledge_sources` table:
 *
 * - `PgKnowledgeSourceRepository`: the Knowledge domain aggregate port
 *   (source persistence, scope-bound reads).
 * - `PgKnowledgeIndexStore`: the Search platform port (`SearchIndexPort`)
 *   — the persisted permission-filtered projection. Scope filtering is
 *   enforced in SQL FIRST (tenant + workspace are part of every query),
 *   then the deterministic lexical scorer ranks the authorized candidates.
 *
 * One table, two roles: the domain store and the search projection are the
 * same rows (DOMAIN_MODEL.md SearchIndexEntry projection is disposable and
 * rebuildable from `knowledge.indexed` events).
 */

import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { KnowledgeSourceRepository } from '@nexora/domain-knowledge';
import { KnowledgeSource, KnowledgeSourceId } from '@nexora/domain-knowledge';
import type {
  SearchEntryKind,
  SearchIndexEntry,
  SearchIndexPort,
  SearchQueryFilter,
} from '@nexora/module-search';
import { rankEntries, tokenize } from '@nexora/module-search';

import type { NexoraDatabase } from '../db.js';
import { knowledgeSources } from '../schema/index.js';

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDate(iso: string): Date {
  return new Date(iso);
}

type KnowledgeRow = typeof knowledgeSources.$inferSelect;

function rowToSourceSnapshot(row: KnowledgeRow): ReturnType<typeof KnowledgeSource.snapshot> {
  return {
    id: KnowledgeSourceId.from(row.id),
    tenantId: row.tenantId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    documentId: row.documentId,
    title: row.title,
    text: row.text,
    version: row.version,
    indexedAt: toIso(row.indexedAt),
  };
}

function sourceSnapshotToRow(snapshot: ReturnType<typeof KnowledgeSource.snapshot>): KnowledgeRow {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId,
    documentId: snapshot.documentId,
    // A KnowledgeSource is always document-shaped; the `kind` column is the
    // generic corpus discriminator (articles never create KnowledgeSources).
    kind: 'document',
    title: snapshot.title,
    text: snapshot.text,
    version: snapshot.version,
    indexedAt: toDate(snapshot.indexedAt),
  };
}

/** Drizzle {@link KnowledgeSourceRepository} implementation. */
export class PgKnowledgeSourceRepository implements KnowledgeSourceRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: KnowledgeSourceId): Promise<KnowledgeSource | undefined> {
    const row = await this.#db.query.knowledgeSources.findFirst({
      where: eq(knowledgeSources.id, id),
    });
    return row === undefined ? undefined : KnowledgeSource.hydrate(rowToSourceSnapshot(row));
  }

  async findByDocument(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    documentId: string,
  ): Promise<KnowledgeSource | undefined> {
    const row = await this.#db.query.knowledgeSources.findFirst({
      where: and(
        eq(knowledgeSources.tenantId, tenantId),
        eq(knowledgeSources.workspaceId, workspaceId),
        eq(knowledgeSources.documentId, documentId),
      ),
    });
    return row === undefined ? undefined : KnowledgeSource.hydrate(rowToSourceSnapshot(row));
  }

  async listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    limit?: number,
  ): Promise<readonly KnowledgeSource[]> {
    const rows = await this.#db.query.knowledgeSources.findMany({
      where: and(
        eq(knowledgeSources.tenantId, tenantId),
        eq(knowledgeSources.workspaceId, workspaceId),
      ),
      orderBy: [desc(knowledgeSources.indexedAt), desc(knowledgeSources.id)],
      limit: limit ?? 100,
    });
    return rows.map((row) => KnowledgeSource.hydrate(rowToSourceSnapshot(row)));
  }

  async save(source: KnowledgeSource): Promise<void> {
    const row = sourceSnapshotToRow(KnowledgeSource.snapshot(source));
    await this.#db
      .insert(knowledgeSources)
      .values(row)
      .onConflictDoUpdate({ target: knowledgeSources.id, set: row });
  }

  async removeByDocument(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    documentId: string,
  ): Promise<void> {
    await this.#db
      .delete(knowledgeSources)
      .where(
        and(
          eq(knowledgeSources.tenantId, tenantId),
          eq(knowledgeSources.workspaceId, workspaceId),
          eq(knowledgeSources.documentId, documentId),
        ),
      );
  }
}

/** Drizzle {@link SearchIndexPort} implementation (the persisted projection). */
export class PgKnowledgeIndexStore implements SearchIndexPort {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async put(entry: SearchIndexEntry): Promise<void> {
    await this.#db
      .insert(knowledgeSources)
      .values({
        id: entry.id,
        tenantId: entry.tenantId,
        workspaceId: entry.workspaceId,
        documentId: entry.scopeId,
        kind: entry.kind,
        title: entry.title,
        text: entry.text,
        version: entry.version,
        indexedAt: toDate(entry.indexedAt),
      })
      .onConflictDoUpdate({
        target: knowledgeSources.id,
        set: {
          kind: entry.kind,
          title: entry.title,
          text: entry.text,
          version: entry.version,
          indexedAt: toDate(entry.indexedAt),
        },
      });
  }

  async removeByScope(scopeId: string, tenantId: string): Promise<void> {
    await this.#db
      .delete(knowledgeSources)
      .where(
        and(eq(knowledgeSources.documentId, scopeId), eq(knowledgeSources.tenantId, tenantId)),
      );
  }

  async query(filter: SearchQueryFilter): Promise<readonly SearchIndexEntry[]> {
    const limit = Math.min(Math.max(1, Math.trunc(filter.limit ?? 5)), 20);
    const excluded = filter.excludeScopeIds ?? [];
    const scopeConditions = [
      eq(knowledgeSources.tenantId, filter.tenantId),
      eq(knowledgeSources.workspaceId, filter.workspaceId),
    ];
    if (excluded.length > 0) {
      scopeConditions.push(notInArray(knowledgeSources.documentId, [...excluded]));
    }

    // AUTHORIZATION FIRST: only the caller's tenant + workspace rows are
    // ever loaded — the model can never widen this scope.
    const rows = await this.#db.query.knowledgeSources.findMany({
      where: and(...scopeConditions),
      orderBy: [desc(knowledgeSources.indexedAt), desc(knowledgeSources.id)],
      limit: 100,
    });
    const entries: SearchIndexEntry[] = rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      scopeId: row.documentId,
      kind: row.kind as SearchEntryKind,
      title: row.title,
      text: row.text,
      version: row.version,
      indexedAt: toIso(row.indexedAt),
    }));
    // Deterministic lexical ranking over the authorized candidates only.
    return rankEntries(entries, tokenize(filter.query), limit);
  }
}
