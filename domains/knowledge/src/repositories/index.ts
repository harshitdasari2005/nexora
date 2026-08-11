/**
 * @nexora/domain-knowledge — repository ports.
 *
 * The persistence seam of the Knowledge bounded context (PERSISTENCE.md §4
 * aggregate ownership). Reads are scope-bound: tenant + workspace are always
 * part of the query, never optional — a source id alone grants nothing.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { KnowledgeSource } from '../entities/knowledge-source.js';
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
