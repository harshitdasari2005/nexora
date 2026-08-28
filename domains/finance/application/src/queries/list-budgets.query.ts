/**
 * @nexora/application-finance — ListBudgets query.
 *
 * Workspace-scoped budget listing (CQRS read side; BACKEND.md §8). The
 * organization + workspace are the trusted scope — the query never returns
 * another workspace's budgets.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { BudgetDto } from '../dto/budget.dto.js';

/** Lists the budgets of a workspace. */
export interface ListBudgetsQuery {
  organizationId: TenantId;
  workspaceId: WorkspaceId;
}

/** The result of {@link ListBudgetsQuery}. */
export type ListBudgetsResult = readonly BudgetDto[];
