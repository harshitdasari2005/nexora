/**
 * @nexora/application-finance — DecideExpense command.
 *
 * The vertical-slice use case that decides a pending expense (`pending` →
 * `approved` | `rejected`, both terminal — BR-19: money movements are
 * Consequential and always require human approval). The organization and
 * workspace are TRUSTED server-side scope: a foreign or cross-workspace
 * expense id resolves to NOT FOUND.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Expense } from '@nexora/module-finance';

/** The decision outcomes an expense may be decided to. */
export type ExpenseDecision = 'approve' | 'reject';

/** Decides a pending expense. */
export interface DecideExpenseCommand {
  expenseId: string;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  decision: ExpenseDecision;
  decidedBy: UserId;
  actorId: UserId;
  correlationId: string;
}

/** The outcome of a successful expense decision. */
export interface DecideExpenseResult {
  expense: Expense;
  events: readonly EventEnvelope[];
}
