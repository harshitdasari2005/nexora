/**
 * @nexora/application-finance — GetBudget query.
 *
 * Single-budget read within the trusted tenant + workspace scope.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { BudgetDto } from '../dto/budget.dto.js';

/** Reads one budget. */
export interface GetBudgetQuery {
  budgetId: string;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
}

/** The result of {@link GetBudgetQuery}. */
export type GetBudgetResult = BudgetDto;
