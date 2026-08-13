/**
 * @nexora/application-documents — UploadDocumentVersion command.
 *
 * The S17 use case that uploads a NEW content revision of an existing
 * document (version history). The new revision becomes the current version
 * and is re-indexed; historical versions are never touched. The tenant +
 * workspace are TRUSTED server-side scope — the caller can only upload a
 * version of a document it can already see.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Document, DocumentVersion } from '@nexora/domain-documents';

/** Uploads a new content revision of an existing document. */
export interface UploadDocumentVersionCommand {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The acting user id. */
  actorId: UserId;
  /** The document id to add the revision to. */
  documentId: string;
  /** The content type of the new revision. */
  contentType: string;
  /** The binary content of the new revision (bytes, not base64). */
  content: Buffer;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful version upload. */
export interface UploadDocumentVersionResult {
  /** The document aggregate (with the new current content). */
  document: Document;
  /** The new immutable version record. */
  version: DocumentVersion;
  /** The new monotonic version number. */
  versionNumber: number;
  /** The extracted searchable text (index with this version). */
  extractedText: string;
  /** Domain events emitted by the use case (published once). */
  events: readonly EventEnvelope[];
}
