/**
 * @nexora/module-finance — domain policies.
 *
 * The Finance bounded context business rules (DOMAIN_MODEL.md §4.4),
 * extracted so the platform can reuse them and so aggregate invariants stay
 * in one authoritative place. Policies are pure: they have no I/O and throw
 * typed domain errors on violation.
 */

import { FinanceStateTransitionError } from '../errors/index.js';
import type { BudgetStatusValue } from '../value-objects/budget-status.js';
import { type BudgetStatus } from '../value-objects/budget-status.js';
import type { ExpenseStatusValue } from '../value-objects/expense-status.js';
import { type ExpenseStatus } from '../value-objects/expense-status.js';

/**
 * The budget lifecycle transition table (DOMAIN_MODEL.md §4.4):
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Active
 *     Active --> UnderReview: flagForReview (deterministic threshold, finance.budget.flagged_for_review)
 *     UnderReview --> Active: clearReview (human resolves, finance.budget.review_cleared)
 *     Active --> Closed: close
 *     UnderReview --> Closed: close
 * ```
 *
 * The single authoritative definition — the Budget aggregate and all
 * policies consult it. `closed` is terminal.
 */
export const BUDGET_TRANSITIONS: Readonly<Record<BudgetStatusValue, readonly BudgetStatusValue[]>> =
  {
    active: ['under_review', 'closed'],
    under_review: ['active', 'closed'],
    closed: [],
  };

/** Budget lifecycle rules: allowed status transitions (DOMAIN_MODEL.md §4.4). */
export class BudgetLifecyclePolicy {
  /** The statuses reachable from the given status. */
  allowedTargets(current: BudgetStatus): readonly BudgetStatusValue[] {
    return BUDGET_TRANSITIONS[current.value];
  }

  /**
   * Asserts the budget may transition to the target status.
   *
   * @throws {FinanceStateTransitionError} when the transition is not allowed.
   */
  assertCanTransition(current: BudgetStatus, target: BudgetStatus): void {
    const allowed = this.allowedTargets(current);
    if (!allowed.includes(target.value)) {
      throw new FinanceStateTransitionError(
        `Cannot transition a budget from ${current.value} to ${target.value}`,
        { from: current.value, to: target.value },
      );
    }
  }
}

/**
 * The expense lifecycle transition table (DOMAIN_MODEL.md §4.4, BR-19: money
 * movements are Consequential and always require human approval):
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Pending
 *     Pending --> Approved: approve (finance.expense.approved)
 *     Pending --> Rejected: reject (finance.expense.rejected)
 * ```
 *
 * Both `approved` and `rejected` are terminal — a decision is never revised
 * (a correction is a new expense, not a re-decided one — same integrity
 * rule as a financial ledger entry).
 */
export const EXPENSE_TRANSITIONS: Readonly<
  Record<ExpenseStatusValue, readonly ExpenseStatusValue[]>
> = {
  pending: ['approved', 'rejected'],
  approved: [],
  rejected: [],
};

/** Expense lifecycle rules: allowed status transitions (DOMAIN_MODEL.md §4.4). */
export class ExpenseLifecyclePolicy {
  /** The statuses reachable from the given status. */
  allowedTargets(current: ExpenseStatus): readonly ExpenseStatusValue[] {
    return EXPENSE_TRANSITIONS[current.value];
  }

  /**
   * Asserts the expense may transition to the target status.
   *
   * @throws {FinanceStateTransitionError} when the transition is not allowed.
   */
  assertCanTransition(current: ExpenseStatus, target: ExpenseStatus): void {
    const allowed = this.allowedTargets(current);
    if (!allowed.includes(target.value)) {
      throw new FinanceStateTransitionError(
        `Cannot transition an expense from ${current.value} to ${target.value}`,
        { from: current.value, to: target.value },
      );
    }
  }
}
