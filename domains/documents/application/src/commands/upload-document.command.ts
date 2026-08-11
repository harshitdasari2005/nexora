/**
 * @nexora/application-documents — UploadDocument command.
 *
 * The vertical-slice use case that uploads a document into a workspace
 * (DOMAIN_MODEL.md §14 Documents): the binary content is stored behind the
 * storage port, the metadata aggregate is persisted, and processing
 * (extraction → available/failed) runs through the same application
 * boundary. The tenant + workspace are TRUSTED server-side scope — never
 * derived from the filename or content.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Document } from '@nexora/domain-documents';

/** Uploads a new document into a workspace. */
export interface UploadDocumentCommand {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The uploading user id (the owner/uploader). */
  uploaderId: UserId;
  /** The document title (validated). */
  title: string;
  /** The upload content type (e.g. `text/plain`, `application/pdf`). */
  contentType: string;
  /** The binary content (bytes, not base64 — the route decodes). */
  content: Buffer;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful upload. */
export interface UploadDocumentResult {
  /** The uploaded document aggregate (final processing state). */
  document: Document;
  /** Domain events emitted by the use case (published once). */
  events: readonly EventEnvelope[];
  /** The extracted searchable text, when processing succeeded. */
  extractedText?: string;
}
