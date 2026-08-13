/**
 * @nexora/application-documents — ArchiveDocumentTemplate command.
 *
 * The S17 use case that archives a document template (`active` →
 * `archived`): the template leaves the workspace picker. The tenant +
 * workspace are TRUSTED server-side scope — a foreign template id resolves
 * to NOT FOUND, never to another workspace's template.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { DocumentTemplate } from '@nexora/domain-documents';

/** Archives a document template in a workspace. */
export interface ArchiveDocumentTemplateCommand {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The acting user id. */
  actorId: UserId;
  /** The template id to archive. */
  templateId: string;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful template archival. */
export interface ArchiveDocumentTemplateResult {
  /** The archived template aggregate. */
  template: DocumentTemplate;
  /** Domain events emitted by the use case. */
  events: readonly EventEnvelope[];
}
