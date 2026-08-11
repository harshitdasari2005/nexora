/**
 * @nexora/application-knowledge — IndexDocument command.
 *
 * The use case that indexes an available document's content into Knowledge
 * (DOMAIN_MODEL.md §14: Documents(ingest) → Knowledge). The tenant +
 * workspace are TRUSTED server-side scope — the model can never supply them.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { KnowledgeSource } from '@nexora/domain-knowledge';

/** Indexes a document's latest content version. */
export interface IndexDocumentCommand {
  /** The owning organization (tenant) id — trusted scope. */
  tenantId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The source document id. */
  documentId: string;
  /** The display title (the citation label). */
  title: string;
  /** The normalized searchable text. */
  text: string;
  /** The indexed content version (stale entries never answer). */
  version: number;
  /** The actor + correlation context. */
  context: { actorId: string; correlationId: string };
}

/** The outcome of a successful index. */
export interface IndexDocumentResult {
  /** The created knowledge source. */
  source: KnowledgeSource;
  /** Domain events emitted by the use case. */
  events: readonly EventEnvelope[];
}
