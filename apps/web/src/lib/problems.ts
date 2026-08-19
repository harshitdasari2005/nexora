/**
 * @nexora/app-web — proactive detection problems client (S27).
 *
 * Loads the caller's detected problems (`GET /api/problems`) and triggers a
 * fresh detection scan (`POST /api/problems/scan`). The server resolves the
 * trusted tenant/workspace/agent capability set — the client only renders.
 */

import { api } from './api.js';
import type { BusinessProblemDto } from './types.js';

/** The tenant/workspace scope of a problems request. */
export interface ProblemsScope {
  /** The current organization id (validated server-side against membership). */
  organizationId: string;
  /** The current workspace id (verified against membership). */
  workspaceId?: string;
}

/** Builds the scope query string. */
function scopeSuffix(scope: ProblemsScope): string {
  const params = new URLSearchParams({ organizationId: scope.organizationId });
  if (scope.workspaceId !== undefined) {
    params.set('workspaceId', scope.workspaceId);
  }
  return `?${params.toString()}`;
}

/** Lists the scope's detected problems (fast read, no re-evaluation). */
export async function fetchProblems(scope: ProblemsScope): Promise<readonly BusinessProblemDto[]> {
  const result = await api<{ problems: readonly BusinessProblemDto[] }>(
    `/problems${scopeSuffix(scope)}`,
  );
  return result.problems;
}

/** Runs a full detection scan for the scope and returns the refreshed list. */
export async function scanProblems(scope: ProblemsScope): Promise<readonly BusinessProblemDto[]> {
  const result = await api<{ problems: readonly BusinessProblemDto[] }>(
    `/problems/scan${scopeSuffix(scope)}`,
    { method: 'POST' },
  );
  return result.problems;
}

/** Resolves one problem by id (tenant-scoped). */
export async function fetchProblem(
  scope: ProblemsScope,
  problemId: string,
): Promise<BusinessProblemDto> {
  const result = await api<{ problem: BusinessProblemDto }>(
    `/problems/${encodeURIComponent(problemId)}${scopeSuffix(scope)}`,
  );
  return result.problem;
}
