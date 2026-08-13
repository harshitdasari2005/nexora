/**
 * @nexora/persistence — knowledge article + category repositories.
 *
 * Drizzle implementations of the Knowledge domain ports for the S18
 * Knowledge Base:
 *
 * - `PgKnowledgeArticleRepository`: the {@link KnowledgeArticle} aggregate
 *   port. Every read is scope-bound (tenant + workspace are part of the
 *   query — a foreign article id grants nothing).
 * - `PgKnowledgeCategoryRepository`: the {@link KnowledgeCategory} aggregate
 *   port (flat, workspace-scoped).
 *
 * Row mapping follows the established branded-cast conventions; the tenant +
 * workspace columns are the immutable isolation scope.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type {
  KnowledgeArticleRepository,
  KnowledgeCategoryRepository,
} from '@nexora/domain-knowledge';
import {
  KnowledgeArticle,
  KnowledgeArticleId,
  KnowledgeCategory,
  KnowledgeCategoryId,
  KnowledgeCategoryNameAlreadyExistsError,
} from '@nexora/domain-knowledge';

import type { NexoraDatabase } from '../db.js';
import { knowledgeArticles, knowledgeCategories } from '../schema/index.js';

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDate(iso: string): Date {
  return new Date(iso);
}

type ArticleRow = typeof knowledgeArticles.$inferSelect;

function rowToArticleSnapshot(row: ArticleRow): ReturnType<typeof KnowledgeArticle.snapshot> {
  return {
    id: KnowledgeArticleId.from(row.id),
    tenantId: row.tenantId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    title: row.title,
    body: row.body,
    categoryId: row.categoryId === null ? undefined : (row.categoryId as never),
    status: row.status,
    contentVersion: row.contentVersion,
    author: row.author as never,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

function articleSnapshotToRow(snapshot: ReturnType<typeof KnowledgeArticle.snapshot>): ArticleRow {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId,
    title: snapshot.title,
    body: snapshot.body,
    categoryId: snapshot.categoryId ?? null,
    status: snapshot.status,
    contentVersion: snapshot.contentVersion,
    author: snapshot.author,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link KnowledgeArticleRepository} implementation. */
export class PgKnowledgeArticleRepository implements KnowledgeArticleRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: string): Promise<KnowledgeArticle | undefined> {
    const row = await this.#db.query.knowledgeArticles.findFirst({
      where: eq(knowledgeArticles.id, id),
    });
    return row === undefined ? undefined : KnowledgeArticle.hydrate(rowToArticleSnapshot(row));
  }

  async listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly KnowledgeArticle[]> {
    const rows = await this.#db.query.knowledgeArticles.findMany({
      where: and(
        eq(knowledgeArticles.tenantId, tenantId),
        eq(knowledgeArticles.workspaceId, workspaceId),
      ),
      orderBy: [desc(knowledgeArticles.updatedAt), desc(knowledgeArticles.id)],
    });
    return rows.map((row) => KnowledgeArticle.hydrate(rowToArticleSnapshot(row)));
  }

  async save(article: KnowledgeArticle): Promise<void> {
    const row = articleSnapshotToRow(KnowledgeArticle.snapshot(article));
    await this.#db
      .insert(knowledgeArticles)
      .values(row)
      .onConflictDoUpdate({ target: knowledgeArticles.id, set: row });
  }
}

type CategoryRow = typeof knowledgeCategories.$inferSelect;

function rowToCategorySnapshot(row: CategoryRow): ReturnType<typeof KnowledgeCategory.snapshot> {
  return {
    id: KnowledgeCategoryId.from(row.id),
    tenantId: row.tenantId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    name: row.name,
    archived: row.archived,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

function categorySnapshotToRow(
  snapshot: ReturnType<typeof KnowledgeCategory.snapshot>,
): CategoryRow {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId,
    name: snapshot.name,
    archived: snapshot.archived,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** PostgreSQL error code for a unique-constraint violation. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/** Drizzle {@link KnowledgeCategoryRepository} implementation. */
export class PgKnowledgeCategoryRepository implements KnowledgeCategoryRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: string): Promise<KnowledgeCategory | undefined> {
    const row = await this.#db.query.knowledgeCategories.findFirst({
      where: eq(knowledgeCategories.id, id),
    });
    return row === undefined ? undefined : KnowledgeCategory.hydrate(rowToCategorySnapshot(row));
  }

  async listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly KnowledgeCategory[]> {
    const rows = await this.#db.query.knowledgeCategories.findMany({
      where: and(
        eq(knowledgeCategories.tenantId, tenantId),
        eq(knowledgeCategories.workspaceId, workspaceId),
      ),
      orderBy: [desc(knowledgeCategories.createdAt), desc(knowledgeCategories.id)],
    });
    return rows.map((row) => KnowledgeCategory.hydrate(rowToCategorySnapshot(row)));
  }

  async existsByName(tenantId: TenantId, workspaceId: WorkspaceId, name: string): Promise<boolean> {
    const row = await this.#db.query.knowledgeCategories.findFirst({
      where: and(
        eq(knowledgeCategories.tenantId, tenantId),
        eq(knowledgeCategories.workspaceId, workspaceId),
        eq(knowledgeCategories.name, name),
      ),
      columns: { id: true },
    });
    return row !== undefined;
  }

  async save(category: KnowledgeCategory): Promise<void> {
    const row = categorySnapshotToRow(KnowledgeCategory.snapshot(category));
    try {
      await this.#db
        .insert(knowledgeCategories)
        .values(row)
        .onConflictDoUpdate({ target: knowledgeCategories.id, set: row });
    } catch (error) {
      // The domain pre-check (existsByName) closes the common duplicate path,
      // but a CONCURRENT duplicate-name insert can still violate the
      // scope-name unique constraint. Map that violation to the domain
      // CONFLICT error instead of leaking a raw 500 INTERNAL_ERROR.
      if (isUniqueViolation(error)) {
        throw new KnowledgeCategoryNameAlreadyExistsError({
          tenantId: row.tenantId,
          workspaceId: row.workspaceId,
          name: row.name,
        });
      }
      throw error;
    }
  }
}
