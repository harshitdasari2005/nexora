/**
 * @nexora/domain-knowledge — repository ports.
 *
 * The persistence seam of the Knowledge bounded context (PERSISTENCE.md §4
 * aggregate ownership). Reads are scope-bound: tenant + workspace are always
 * part of the query, never optional — a source id alone grants nothing.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { KnowledgeArticle } from '../entities/knowledge-article.js';
import type { KnowledgeCategory } from '../entities/knowledge-category.js';
import type { KnowledgeSource } from '../entities/knowledge-source.js';
import type { KnowledgeArticleId } from '../value-objects/knowledge-article-id.js';
import type { KnowledgeCategoryId } from '../value-objects/knowledge-category-id.js';
import type { KnowledgeSourceId } from '../value-objects/knowledge-source-id.js';

/** The Knowledge aggregate persistence port. */
export interface KnowledgeSourceRepository {
  /** Finds a source by id (returns `undefined` otherwise). */
  findById(id: KnowledgeSourceId): Promise<KnowledgeSource | undefined>;

  /** Finds the indexed source of a document within a scope, if any. */
  findByDocument(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    documentId: string,
  ): Promise<KnowledgeSource | undefined>;

  /** Lists the indexed sources of a workspace (bounded, newest first). */
  listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    limit?: number,
  ): Promise<readonly KnowledgeSource[]>;

  /** Persists (inserts or replaces) a knowledge source. */
  save(source: KnowledgeSource): Promise<void>;

  /** Removes the indexed source of a document within a scope (idempotent). */
  removeByDocument(tenantId: TenantId, workspaceId: WorkspaceId, documentId: string): Promise<void>;
}

/** The knowledge article persistence port (S18). */
export interface KnowledgeArticleRepository {
  /** Finds an article by id (returns `undefined` otherwise). */
  findById(id: KnowledgeArticleId): Promise<KnowledgeArticle | undefined>;

  /** Lists the articles of a workspace, newest first (scope-bound). */
  listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly KnowledgeArticle[]>;

  /** Persists (inserts or replaces) an article. */
  save(article: KnowledgeArticle): Promise<void>;
}

/** The knowledge category persistence port (S18). */
export interface KnowledgeCategoryRepository {
  /** Finds a category by id (returns `undefined` otherwise). */
  findById(id: KnowledgeCategoryId): Promise<KnowledgeCategory | undefined>;

  /** Lists the categories of a workspace, newest first (scope-bound). */
  listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly KnowledgeCategory[]>;

  /** Whether a category with this name already exists in the scope. */
  existsByName(tenantId: TenantId, workspaceId: WorkspaceId, name: string): Promise<boolean>;

  /** Persists (inserts or replaces) a category. */
  save(category: KnowledgeCategory): Promise<void>;
}
