/**
 * @nexora/application-knowledge — CreateCategory command.
 *
 * The use case that creates a flat, workspace-scoped knowledge category
 * (S18 Knowledge Base). The tenant + workspace are TRUSTED server-side
 * scope — the model can never choose them.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { KnowledgeCategory } from '@nexora/domain-knowledge';

/** Creates a knowledge category in a workspace. */
export interface CreateCategoryCommand {
  /** The owning organization (tenant) id — trusted scope. */
  tenantId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The acting user id — trusted context. */
  actorId: UserId;
  /** The category name. */
  name: string;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful category creation. */
export interface CreateCategoryResult {
  /** The created category. */
  category: KnowledgeCategory;
  /** Domain events emitted by the use case. */
  events: readonly EventEnvelope[];
}
