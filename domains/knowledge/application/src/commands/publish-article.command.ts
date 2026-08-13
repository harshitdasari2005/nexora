/**
 * @nexora/application-knowledge — PublishArticle command.
 *
 * The use case that publishes a knowledge article (`draft` → `published`).
 * Publishing is the freshness gate: the orchestration layer indexes the
 * article afterwards so it becomes retrievable (BR-7). Only the trusted
 * tenant + workspace scope can publish — the model cannot select identity.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { KnowledgeArticle } from '@nexora/domain-knowledge';

/** Publishes a knowledge article (draft → published). */
export interface PublishArticleCommand {
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

/** The outcome of a successful article publish. */
export interface PublishArticleResult {
  /** The published article. */
  article: KnowledgeArticle;
  /** Domain events emitted by the use case. */
  events: readonly EventEnvelope[];
}
