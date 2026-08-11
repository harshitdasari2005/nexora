/**
 * @nexora/application-documents — ArchiveDocument command.
 *
 * The vertical-slice use case that archives a document (`available` →
 * `archived`): the document leaves the knowledge index and its content is
 * removed from storage. The workspace scope is trusted server-side state —
 * a foreign document id resolves to NOT FOUND, never to another tenant's
 * record.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Document } from '@nexora/domain-documents';

/** Archives a document in a workspace. */
export interface ArchiveDocumentCommand {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The acting user id. */
  actorId: UserId;
  /** The document id to archive. */
  documentId: string;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful archive. */
export interface ArchiveDocumentResult {
  /** The archived document aggregate. */
  document: Document;
  /** Domain events emitted by the use case. */
  events: readonly EventEnvelope[];
}
