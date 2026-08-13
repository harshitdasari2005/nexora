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
import type { DocumentTemplate } from '../entities/document-template.js';
import type { DocumentVersion } from '../entities/document-version.js';
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

/**
 * The Documents version-history persistence port (S17 versioning). The
 * history is an immutable append-only store: save is insert-only by
 * contract, and a unique (document, version) constraint defends monotonicity
 * in the database as well. Every read is scoped by the owning document (the
 * caller verifies the document against TRUSTED tenant + workspace first).
 */
export interface DocumentVersionRepository {
  /**
   * Lists the content revisions of a document, oldest first (ascending
   * version — the version-history order).
   */
  listByDocument(documentId: DocumentId): Promise<readonly DocumentVersion[]>;

  /**
   * Finds a specific content revision of a document, or `undefined` (an
   * invalid (document, version) combination resolves to NOT FOUND — never
   * to another workspace's record).
   */
  findByDocumentAndVersion(
    documentId: DocumentId,
    version: number,
  ): Promise<DocumentVersion | undefined>;

  /** Appends a new immutable content revision (insert-only). */
  save(version: DocumentVersion): Promise<void>;
}

/**
 * The Documents template persistence port (S17 templates). Every read is
 * scope-bound: the workspace is part of the query, never optional.
 */
export interface DocumentTemplateRepository {
  /** Finds a template by id (the caller verifies scope against TRUSTED state). */
  findById(templateId: string): Promise<DocumentTemplate | undefined>;

  /**
   * Lists the ACTIVE templates of a workspace (the template picker read —
   * archived templates never appear). The workspace scope is REQUIRED.
   */
  listActiveByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly DocumentTemplate[]>;

  /** Persists (inserts or replaces) a template aggregate. */
  save(template: DocumentTemplate): Promise<void>;
}
