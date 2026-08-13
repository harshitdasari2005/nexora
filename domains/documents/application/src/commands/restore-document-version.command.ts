/**
 * @nexora/application-documents — RestoreDocumentVersion command.
 *
 * The S17 use case that restores a historical content revision as a NEW
 * current version (v4 = content of v1). The historical version is never
 * mutated — the restored bytes are copied forward into a fresh storage key
 * and a new version record. The tenant + workspace are TRUSTED server-side
 * scope; an invalid (document, version) combination resolves to NOT FOUND.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Document, DocumentVersion } from '@nexora/domain-documents';

/** Restores a historical version as the document's new current version. */
export interface RestoreDocumentVersionCommand {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The acting user id. */
  actorId: UserId;
  /** The document id. */
  documentId: string;
  /** The historical version whose content is restored. */
  version: number;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful restore. */
export interface RestoreDocumentVersionResult {
  /** The document aggregate (with the restored content as current). */
  document: Document;
  /** The NEW version record (never a mutation of the historical one). */
  version: DocumentVersion;
  /** The new monotonic version number. */
  versionNumber: number;
  /** The historical version the content was copied from. */
  restoredFromVersion: number;
  /** The extracted searchable text of the restored content. */
  extractedText: string;
  /** Domain events emitted by the use case (published once). */
  events: readonly EventEnvelope[];
}
