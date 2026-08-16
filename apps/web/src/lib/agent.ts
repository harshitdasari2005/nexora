/**
 * @nexora/app-web — governed business-agent client (S26 Phase 8).
 *
 * Loads the caller's agent (`GET /api/agent`) and executes governed intents
 * (`POST /api/agent/proposals/:proposalId/execute` and `POST /api/agent/execute`).
 * The server resolves the trusted tenant/workspace/role/agent — the client
 * only renders. Approval decisions reuse the EXISTING chat approval surface
 * (`decideApproval` from `./chat.js`) — one approval path.
 */

import { api } from './api.js';
import type { AgentExecutionResponse, BusinessAgentDto } from './types.js';

/** The tenant/workspace scope of an agent request. */
export interface AgentScope {
  /** The current organization id (validated server-side against membership). */
  organizationId: string;
  /** The current workspace id (verified against membership). */
  workspaceId?: string;
}

/** Builds the scope query string. */
function scopeSuffix(scope: AgentScope): string {
  const params = new URLSearchParams({ organizationId: scope.organizationId });
  if (scope.workspaceId !== undefined) {
    params.set('workspaceId', scope.workspaceId);
  }
  return `?${params.toString()}`;
}

/** Loads the caller's governed business agent. */
export async function fetchAgent(scope: AgentScope): Promise<BusinessAgentDto> {
  return api<BusinessAgentDto>(`/agent${scopeSuffix(scope)}`);
}

/** Executes a governed proposal (re-derived + capability-validated server-side). */
export async function executeProposal(
  scope: AgentScope,
  proposalId: string,
): Promise<AgentExecutionResponse> {
  return api<AgentExecutionResponse>(
    `/agent/proposals/${encodeURIComponent(proposalId)}/execute${scopeSuffix(scope)}`,
    { method: 'POST' },
  );
}

/** Executes a free-form intent bound to the agent's registered capability set. */
export async function executeAgentIntent(
  scope: AgentScope,
  utterance: string,
): Promise<AgentExecutionResponse> {
  return api<AgentExecutionResponse>(`/agent/execute${scopeSuffix(scope)}`, {
    method: 'POST',
    body: JSON.stringify({ utterance }),
  });
}
