/**
 * @nexora/application-documents — CreateDocumentTemplate command.
 *
 * The S17 use case that creates a reusable document template within a
 * tenant + workspace: the starter content is stored behind the storage port,
 * the template aggregate is persisted, and the template is available to the
 * workspace picker. The tenant + workspace are TRUSTED server-side scope —
 * the model can never choose identity.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { DocumentTemplate } from '@nexora/domain-documents';

/** Creates a document template in a workspace. */
export interface CreateDocumentTemplateCommand {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The acting user id. */
  actorId: UserId;
  /** The template name (validated). */
  name: string;
  /** An optional human-readable description. */
  description?: string;
  /** The starter content type (e.g. `text/markdown`). */
  contentType: string;
  /** The binary starter content (bytes, not base64). */
  content: Buffer;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful template creation. */
export interface CreateDocumentTemplateResult {
  /** The created template aggregate. */
  template: DocumentTemplate;
  /** Domain events emitted by the use case (published once). */
  events: readonly EventEnvelope[];
}
