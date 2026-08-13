/**
 * @nexora/application-knowledge — CreateArticle command.
 *
 * The use case that creates a knowledge article as a DRAFT (S18 Knowledge
 * Base). Drafts are never indexed — retrieval only ever sees published
 * articles. The tenant + workspace are TRUSTED server-side scope — the model
 * can never supply them.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { KnowledgeArticle } from '@nexora/domain-knowledge';

/** Creates a knowledge article as a draft. */
export interface CreateArticleCommand {
  /** The owning organization (tenant) id — trusted scope. */
  tenantId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The authoring user id — trusted context. */
  actorId: UserId;
  /** The article title. */
  title: string;
  /** The article body. */
  body: string;
  /** The optional owning category id (flat, one per article). */
  categoryId?: string;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful article creation. */
export interface CreateArticleResult {
  /** The created article. */
  article: KnowledgeArticle;
  /** Domain events emitted by the use case. */
  events: readonly EventEnvelope[];
}
