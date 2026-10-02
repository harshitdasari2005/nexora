/**
 * @nexora/app-web — governed remediation planning client (Phase 10).
 *
 * The hero-flow surface: problem → plan → approve → execute → verify →
 * resolved. Every call goes through the EXISTING governed remediation
 * engine (`POST /api/problems/:problemId/plans`, `POST
 * /api/plans/:planId/advance|replan|cancel`, `GET /api/plans`). Approval
 * decisions reuse the EXISTING chat approval surface (`decideApproval` from
 * `./chat.js`) — one approval path, same as the Agent page.
 */

import { api } from './api.js';
import type { RemediationPlanDto } from './types.js';

/** The tenant/workspace scope of a remediation request. */
export interface RemediationScope {
  /** The current organization id (validated server-side against membership). */
  organizationId: string;
  /** The current workspace id (verified against membership). */
  workspaceId?: string;
}

/** Builds the scope query string. */
function scopeSuffix(scope: RemediationScope): string {
  const params = new URLSearchParams({ organizationId: scope.organizationId });
  if (scope.workspaceId !== undefined) {
    params.set('workspaceId', scope.workspaceId);
  }
  return `?${params.toString()}`;
}

/** Creates a remediation plan for a problem (idempotent while one is active). */
export async function createRemediationPlan(
  scope: RemediationScope,
  problemId: string,
  solutionId?: string,
): Promise<RemediationPlanDto> {
  const result = await api<{ plan: RemediationPlanDto }>(
    `/problems/${encodeURIComponent(problemId)}/plans${scopeSuffix(scope)}`,
    { method: 'POST', body: JSON.stringify(solutionId === undefined ? {} : { solutionId }) },
  );
  return result.plan;
}

/** Advances a plan: executes the next step, or opens/checks its approval. */
export async function advanceRemediationPlan(
  scope: RemediationScope,
  planId: string,
): Promise<RemediationPlanDto> {
  const result = await api<{ plan: RemediationPlanDto }>(
    `/plans/${encodeURIComponent(planId)}/advance${scopeSuffix(scope)}`,
    { method: 'POST' },
  );
  return result.plan;
}

/** Re-derives the plan from the current problem state (bounded). */
export async function replanRemediationPlan(
  scope: RemediationScope,
  planId: string,
): Promise<RemediationPlanDto> {
  const result = await api<{ plan: RemediationPlanDto }>(
    `/plans/${encodeURIComponent(planId)}/replan${scopeSuffix(scope)}`,
    { method: 'POST' },
  );
  return result.plan;
}

/** Cancels a plan (human decision; the problem stays open). */
export async function cancelRemediationPlan(
  scope: RemediationScope,
  planId: string,
): Promise<RemediationPlanDto> {
  const result = await api<{ plan: RemediationPlanDto }>(
    `/plans/${encodeURIComponent(planId)}/cancel${scopeSuffix(scope)}`,
    { method: 'POST' },
  );
  return result.plan;
}

/** Lists the scope's remediation plans (bounded, newest first). */
export async function fetchRemediationPlans(
  scope: RemediationScope,
): Promise<readonly RemediationPlanDto[]> {
  const result = await api<{ plans: readonly RemediationPlanDto[] }>(`/plans${scopeSuffix(scope)}`);
  return result.plans;
}
