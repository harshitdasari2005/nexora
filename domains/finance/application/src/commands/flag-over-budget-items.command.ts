/**
 * @nexora/application-finance — FlagOverBudgetItems command.
 *
 * The DETERMINISTIC remediation use case behind the `finance.flag_over_
 * budget_items` capability (parameterless — the remediation engine can only
 * execute parameterless capabilities; see PlanBuilder's doc comment on
 * `projects.find_project`). It re-scans EVERY active budget in the trusted
 * workspace, computes utilization the SAME way the `finance_budget_overrun`
 * detection signal does (never an LLM decision), and flags every budget at
 * or above the SAME hard-coded high-utilization threshold for review — a
 * real, persisted, verifiable state change, not a notify-only no-op.
 *
 * Budgets that are no longer `active` by the time this runs (a human
 * already closed or flagged them) are silently skipped — a live re-scan
 * tolerates state that has moved on; it never treats that as an error.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Budget } from '@nexora/module-finance';

/** Flags every over-threshold active budget in a workspace for review. */
export interface FlagOverBudgetItemsCommand {
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  actorId: UserId;
  correlationId: string;
}

/** The outcome of a flag-over-budget-items run. */
export interface FlagOverBudgetItemsResult {
  /** The budgets newly flagged `under_review` by this run. */
  flagged: readonly Budget[];
  events: readonly EventEnvelope[];
}
