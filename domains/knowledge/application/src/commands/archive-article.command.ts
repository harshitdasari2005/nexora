/**
 * @nexora/application-knowledge — ArchiveArticle command.
 *
 * The use case that archives a knowledge article (terminal). Archiving is
 * the removal gate: the orchestration layer removes the article from the
 * search corpus so an archived article can never answer retrieval.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { KnowledgeArticle } from '@nexora/domain-knowledge';

/** Archives a knowledge article (draft/published → archived). */
export interface ArchiveArticleCommand {
  /** The owning organization (tenant) id — trusted scope. */
  tenantId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The acting user id — trusted context. */
  actorId: UserId;
  /** The article id. */
  articleId: string;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful article archive. */
export interface ArchiveArticleResult {
  /** The archived article. */
  article: KnowledgeArticle;
  /** Domain events emitted by the use case. */
  events: readonly EventEnvelope[];
}
