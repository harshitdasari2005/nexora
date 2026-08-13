/**
 * @nexora/application-documents — CreateDocumentFromTemplate command.
 *
 * The S17 use case that creates a NEW document whose content is the template
 * starter content (use-template flow). The document is created through the
 * SAME upload pipeline as a manual upload — one business execution path —
 * and is indexed like any other document. The tenant + workspace are TRUSTED
 * server-side scope: the template must belong to the caller's workspace, and
 * the created document inherits the trusted scope (never model-supplied).
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Document } from '@nexora/domain-documents';

/** Creates a document from a workspace template. */
export interface CreateDocumentFromTemplateCommand {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The acting user id. */
  actorId: UserId;
  /** The template id to use. */
  templateId: string;
  /** The new document title (validated). */
  title: string;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful create-from-template. */
export interface CreateDocumentFromTemplateResult {
  /** The created document aggregate (final processing state). */
  document: Document;
  /** The extracted searchable text, when processing succeeded. */
  extractedText?: string;
  /** Domain events emitted by the use case (published once). */
  events: readonly EventEnvelope[];
}
