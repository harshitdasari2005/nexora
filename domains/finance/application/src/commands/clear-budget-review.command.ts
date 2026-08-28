/**
 * @nexora/application-finance — ClearBudgetReview command.
 *
 * The vertical-slice use case that clears a budget's review flag
 * (`under_review` → `active`) — a human decision that the current numbers
 * are acceptable. The organization and workspace are TRUSTED server-side
 * scope: a foreign or cross-workspace budget id resolves to NOT FOUND.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Budget } from '@nexora/module-finance';

/** Clears a budget's review flag. */
export interface ClearBudgetReviewCommand {
  budgetId: string;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  actorId: UserId;
  correlationId: string;
}

/** The outcome of a successful review clear. */
export interface ClearBudgetReviewResult {
  budget: Budget;
  events: readonly EventEnvelope[];
}
