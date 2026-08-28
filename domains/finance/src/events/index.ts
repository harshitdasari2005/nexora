/**
 * @nexora/module-finance — domain events.
 *
 * The Finance bounded context event vocabulary (DOMAIN_MODEL.md §4.4:
 * `BudgetExceeded`, `ExpenseApproved`). Finance is a *Supporting* domain
 * (DOMAIN_MODEL.md DOM-08), so finance events ride the canonical
 * `@nexora/shared/events` envelope with category `finance`; the platform
 * event-bus (SAD.md §11) consumes this shape — including the EXISTING
 * notification/activity-feed pipeline, unchanged.
 *
 * Every event carries the organization (tenant) id (context contract) and
 * the workspace id ON THE ENVELOPE (budgets and expenses are
 * workspace-scoped) so the notification policy can scope
 * notifications/activity to the workspace.
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import type { BudgetId } from '../value-objects/budget-id.js';
import type { ExpenseId } from '../value-objects/expense-id.js';

/** Category applied to every Finance domain event (DOM-08 Supporting). */
export const FINANCE_EVENT_CATEGORY = 'finance' as const;

/** Stable event type names (finance vertical slice event catalog). */
export const FINANCE_EVENT_TYPES = {
  budgetCreated: 'finance.budget.created',
  budgetRevised: 'finance.budget.revised',
  budgetFlaggedForReview: 'finance.budget.flagged_for_review',
  budgetReviewCleared: 'finance.budget.review_cleared',
  budgetClosed: 'finance.budget.closed',
  expenseSubmitted: 'finance.expense.submitted',
  expenseApproved: 'finance.expense.approved',
  expenseRejected: 'finance.expense.rejected',
} as const;

/** Context required to emit a Finance domain event. */
export interface FinanceEventContext {
  /** The actor that caused the event. */
  actor: EventActor;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id (finance records are workspace-scoped). */
  workspaceId: WorkspaceId;
}

/** Payload of the {@link budgetCreatedEvent}. */
export interface BudgetCreatedPayload {
  budgetId: BudgetId;
  name: string;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  createdBy: UserId;
  allocatedMinorUnits: number;
  currency: string;
  status: string;
}

/** Payload of the {@link budgetRevisedEvent}. */
export interface BudgetRevisedPayload {
  budgetId: BudgetId;
  name: string;
  allocatedMinorUnits: number;
  currency: string;
}

/** Payload of a budget lifecycle-only transition (flag/clear/close). */
export interface BudgetTransitionPayload {
  budgetId: BudgetId;
  status: string;
}

/** Payload of the {@link expenseSubmittedEvent}. */
export interface ExpenseSubmittedPayload {
  expenseId: ExpenseId;
  budgetId: BudgetId;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  submittedBy: UserId;
  amountMinorUnits: number;
  currency: string;
  status: string;
}

/** Payload of an expense decision (approve/reject). */
export interface ExpenseDecidedPayload {
  expenseId: ExpenseId;
  budgetId: BudgetId;
  decidedBy: UserId;
  status: string;
}

/** Creates a typed Finance domain event envelope with canonical metadata. */
function financeEvent<P>(
  type: string,
  context: FinanceEventContext,
  payload: P,
  version = 1,
): EventEnvelope<P> {
  return createEventEnvelope({
    type,
    version,
    actor: context.actor,
    correlationId: context.correlationId,
    tenantId: context.organizationId,
    workspaceId: context.workspaceId,
    payload,
    metadata: {
      version,
      category: FINANCE_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** A budget was created (finance.budget.created). */
export function budgetCreatedEvent(
  context: FinanceEventContext,
  payload: BudgetCreatedPayload,
): EventEnvelope<BudgetCreatedPayload> {
  return financeEvent(FINANCE_EVENT_TYPES.budgetCreated, context, payload);
}

/** A budget was revised (finance.budget.revised). */
export function budgetRevisedEvent(
  context: FinanceEventContext,
  payload: BudgetRevisedPayload,
): EventEnvelope<BudgetRevisedPayload> {
  return financeEvent(FINANCE_EVENT_TYPES.budgetRevised, context, payload);
}

/** A budget was flagged for review (finance.budget.flagged_for_review). */
export function budgetFlaggedForReviewEvent(
  context: FinanceEventContext,
  budgetId: BudgetId,
): EventEnvelope<BudgetTransitionPayload> {
  return financeEvent(FINANCE_EVENT_TYPES.budgetFlaggedForReview, context, {
    budgetId,
    status: 'under_review',
  });
}

/** A budget's review flag was cleared (finance.budget.review_cleared). */
export function budgetReviewClearedEvent(
  context: FinanceEventContext,
  budgetId: BudgetId,
): EventEnvelope<BudgetTransitionPayload> {
  return financeEvent(FINANCE_EVENT_TYPES.budgetReviewCleared, context, {
    budgetId,
    status: 'active',
  });
}

/** A budget was closed (finance.budget.closed). */
export function budgetClosedEvent(
  context: FinanceEventContext,
  budgetId: BudgetId,
): EventEnvelope<BudgetTransitionPayload> {
  return financeEvent(FINANCE_EVENT_TYPES.budgetClosed, context, {
    budgetId,
    status: 'closed',
  });
}

/** An expense was submitted (finance.expense.submitted). */
export function expenseSubmittedEvent(
  context: FinanceEventContext,
  payload: ExpenseSubmittedPayload,
): EventEnvelope<ExpenseSubmittedPayload> {
  return financeEvent(FINANCE_EVENT_TYPES.expenseSubmitted, context, payload);
}

/** An expense was approved (finance.expense.approved — BR-19 money movement). */
export function expenseApprovedEvent(
  context: FinanceEventContext,
  payload: ExpenseDecidedPayload,
): EventEnvelope<ExpenseDecidedPayload> {
  return financeEvent(FINANCE_EVENT_TYPES.expenseApproved, context, payload);
}

/** An expense was rejected (finance.expense.rejected). */
export function expenseRejectedEvent(
  context: FinanceEventContext,
  payload: ExpenseDecidedPayload,
): EventEnvelope<ExpenseDecidedPayload> {
  return financeEvent(FINANCE_EVENT_TYPES.expenseRejected, context, payload);
}
