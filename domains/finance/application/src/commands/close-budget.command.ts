/**
 * @nexora/application-finance — CloseBudget command.
 *
 * The vertical-slice use case that closes a budget (`active|under_review` →
 * `closed`, terminal). The organization and workspace are TRUSTED
 * server-side scope: a foreign or cross-workspace budget id resolves to NOT
 * FOUND, never to another workspace's budget.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Budget } from '@nexora/module-finance';

/** Closes a budget. */
export interface CloseBudgetCommand {
  budgetId: string;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  actorId: UserId;
  correlationId: string;
}

/** The outcome of a successful budget close. */
export interface CloseBudgetResult {
  budget: Budget;
  events: readonly EventEnvelope[];
}
