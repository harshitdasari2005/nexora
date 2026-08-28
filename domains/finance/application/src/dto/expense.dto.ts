/**
 * @nexora/application-finance — expense DTO.
 *
 * The public representation of an expense returned by queries and APIs.
 * Internal aggregates never cross module boundaries.
 */

import type { Expense } from '@nexora/module-finance';

/** The public expense representation. */
export interface ExpenseDto {
  id: string;
  organizationId: string;
  workspaceId: string;
  budgetId: string;
  submittedBy: string;
  description: string;
  amountMinorUnits: number;
  currency: string;
  status: string;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

/** Maps an {@link Expense} aggregate to its {@link ExpenseDto}. */
export function toExpenseDto(expense: Expense): ExpenseDto {
  return {
    id: expense.id,
    organizationId: expense.organizationId,
    workspaceId: expense.workspaceId,
    budgetId: expense.budgetId,
    submittedBy: expense.submittedBy,
    description: expense.description.value,
    amountMinorUnits: expense.amount.minorUnits,
    currency: expense.amount.currency,
    status: expense.status.value,
    decidedBy: expense.decidedBy,
    decidedAt: expense.decidedAt,
    createdAt: expense.createdAt,
  };
}
