/**
 * @nexora/application-finance — CreateBudget command.
 *
 * The vertical-slice use case that creates a budget in a workspace
 * (DOMAIN_MODEL.md §4.4): the budget is created in `active` status. The
 * organization (tenant) and workspace are TRUSTED server-side scope — the
 * HTTP route supplies them from the authenticated context, never from
 * client input.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Budget } from '@nexora/module-finance';

/** Creates a new budget in a workspace. */
export interface CreateBudgetCommand {
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  createdBy: UserId;
  name: string;
  allocatedMinorUnits: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  actorId: UserId;
  correlationId: string;
}

/** The outcome of a successful budget creation. */
export interface CreateBudgetResult {
  budget: Budget;
  events: readonly EventEnvelope[];
}
