/**
 * @nexora/application-knowledge — UpdateArticle command.
 *
 * The use case that updates an article's content (S18 Knowledge Base).
 * Content edits bump the monotonic contentVersion; a PUBLISHED article is
 * re-indexed by the orchestration layer so the corpus never serves stale
 * article content. The tenant + workspace are TRUSTED server-side scope.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { KnowledgeArticle } from '@nexora/domain-knowledge';

/** Updates a knowledge article's content. */
export interface UpdateArticleCommand {
  /** The owning organization (tenant) id — trusted scope. */
  tenantId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The acting user id — trusted context. */
  actorId: UserId;
  /** The article id. */
  articleId: string;
  /** The new article title. */
  title: string;
  /** The new article body. */
  body: string;
  /** The optional owning category id (empty clears the reference). */
  categoryId?: string;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful article update. */
export interface UpdateArticleResult {
  /** The updated article. */
  article: KnowledgeArticle;
  /** Domain events emitted by the use case. */
  events: readonly EventEnvelope[];
}
