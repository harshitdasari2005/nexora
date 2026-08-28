/**
 * @nexora/application-finance — ListExpenses query.
 *
 * Workspace-scoped expense listing (CQRS read side; BACKEND.md §8). The
 * organization + workspace are the trusted scope — the query never returns
 * another workspace's expenses.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { ExpenseDto } from '../dto/expense.dto.js';

/** Lists the expenses of a workspace. */
export interface ListExpensesQuery {
  organizationId: TenantId;
  workspaceId: WorkspaceId;
}

/** The result of {@link ListExpensesQuery}. */
export type ListExpensesResult = readonly ExpenseDto[];
