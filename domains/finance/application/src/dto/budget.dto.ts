/**
 * @nexora/application-finance — budget DTO.
 *
 * The public representation of a budget returned by queries and APIs.
 * Internal aggregates never cross module boundaries.
 */

import type { Budget } from '@nexora/module-finance';

/** The public budget representation. */
export interface BudgetDto {
  id: string;
  organizationId: string;
  workspaceId: string;
  createdBy: string;
  name: string;
  allocatedMinorUnits: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
}

/** Maps a {@link Budget} aggregate to its {@link BudgetDto}. */
export function toBudgetDto(budget: Budget): BudgetDto {
  return {
    id: budget.id,
    organizationId: budget.organizationId,
    workspaceId: budget.workspaceId,
    createdBy: budget.createdBy,
    name: budget.name.value,
    allocatedMinorUnits: budget.allocated.minorUnits,
    currency: budget.allocated.currency,
    periodStart: budget.period.periodStart,
    periodEnd: budget.period.periodEnd,
    status: budget.status.value,
    createdAt: budget.createdAt,
  };
}
