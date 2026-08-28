/**
 * @nexora/application-finance — SubmitExpense command.
 *
 * The vertical-slice use case that submits an expense claim against a
 * budget in a workspace (DOMAIN_MODEL.md §4.4): the expense is created in
 * `pending` status. The organization (tenant) and workspace are TRUSTED
 * server-side scope. The referenced budget must exist, be visible in the
 * trusted scope, and not be `closed` — an expense claimed against a budget
 * the caller cannot see or that is no longer open resolves to a domain
 * error, never silently orphaned.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Expense } from '@nexora/module-finance';

/** Submits a new expense claim. */
export interface SubmitExpenseCommand {
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  budgetId: string;
  submittedBy: UserId;
  description: string;
  amountMinorUnits: number;
  currency: string;
  actorId: UserId;
  correlationId: string;
}

/** The outcome of a successful expense submission. */
export interface SubmitExpenseResult {
  expense: Expense;
  events: readonly EventEnvelope[];
}
