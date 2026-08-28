/**
 * @nexora/application-finance — GetExpense query.
 *
 * Single-expense read within the trusted tenant + workspace scope.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { ExpenseDto } from '../dto/expense.dto.js';

/** Reads one expense. */
export interface GetExpenseQuery {
  expenseId: string;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
}

/** The result of {@link GetExpenseQuery}. */
export type GetExpenseResult = ExpenseDto;
