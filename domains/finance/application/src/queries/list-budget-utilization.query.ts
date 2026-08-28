/**
 * @nexora/application-finance — ListBudgetUtilization query.
 *
 * Workspace-scoped budget-utilization projection (CQRS read side). This is
 * the ONE place "spent" is computed (approved expenses summed per budget) —
 * reused by the REST API, the Command Center widget provider, and the
 * detection snapshot loader (finance section), so the number a CFO sees on
 * their dashboard, the number the detection signal thresholds against, and
 * the number the API returns are always the same number.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { BudgetUtilizationDto } from '../dto/budget-utilization.dto.js';

/** Lists the utilization of every budget in a workspace. */
export interface ListBudgetUtilizationQuery {
  organizationId: TenantId;
  workspaceId: WorkspaceId;
}

/** The result of {@link ListBudgetUtilizationQuery}. */
export type ListBudgetUtilizationResult = readonly BudgetUtilizationDto[];
