/**
 * @nexora/domain-documents — repository ports.
 *
 * The persistence seam of the Documents bounded context (PERSISTENCE.md §4
 * aggregate ownership). Every read is scope-bound: tenant + workspace are
 * always part of the query, never optional — a document id alone grants
 * nothing (authorization is evaluated by the caller against TRUSTED scope,
 * and the repository enforces scope as defense-in-depth).
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { Document } from '../entities/document.js';
import type { DocumentId } from '../value-objects/document-id.js';

/** The Documents aggregate persistence port. */
export interface DocumentRepository {
  /** Finds a document by id within its tenant (returns `undefined` otherwise). */
  findById(documentId: DocumentId): Promise<Document | undefined>;

  /**
   * Lists the documents of a workspace, newest first. The workspace scope is
   * REQUIRED — this port never returns documents from another workspace.
   */
  listByWorkspace(organizationId: TenantId, workspaceId: WorkspaceId): Promise<readonly Document[]>;

  /** Persists (inserts or replaces) a document aggregate. */
  save(document: Document): Promise<void>;
}
