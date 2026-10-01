/**
 * @nexora/app-web — agent identity management client.
 *
 * Typed wrappers over `/api/agents/*`: list/create/inspect agent identities,
 * suspend/reactivate/revoke them, and grant/revoke capability delegations.
 * The organization + workspace scope travels ONLY in the querystring; bodies
 * never carry userId/owner/organization/workspace — the server derives the
 * caller's authority from the session and re-checks it on every call.
 */

import { api } from './api.js';

/** The (required) tenant + workspace scope of an agent-identity request. */
export interface AgentIdentityScope {
  organizationId: string;
  workspaceId: string;
}

/** The lifecycle status of an agent identity. */
export type AgentIdentityStatus = 'active' | 'suspended' | 'revoked';

/** An agent identity (`AgentPrincipal`). */
export interface AgentIdentityDto {
  id: string;
  organizationId: string;
  workspaceId: string;
  definitionId: string;
  name: string;
  description: string;
  status: AgentIdentityStatus;
  ownerUserId: string;
  createdBy: string;
  statusChangedBy?: string;
  statusReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** The resource a delegation is restricted to. */
export interface AgentDelegationResourceScope {
  kind: 'project' | 'budget';
  id: string;
}

/** The effective state of a delegation (`expired` is derived server-side). */
export type AgentDelegationEffectiveStatus = 'active' | 'revoked' | 'expired';

/** A delegation with its effective status. */
export interface AgentDelegationDto {
  id: string;
  agentId: string;
  grantedByUserId: string;
  capabilityId: string;
  resourceScope?: AgentDelegationResourceScope;
  status: 'active' | 'revoked';
  effectiveStatus: AgentDelegationEffectiveStatus;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
}

/** `GET /api/agents/:agentId` — an agent's inspected authority. */
export interface AgentAuthorityDto {
  agent: AgentIdentityDto;
  delegations: readonly AgentDelegationDto[];
  effectiveCapabilityIds: readonly string[];
  definitionCapabilityIds: readonly string[];
}

/** The body of a delegation grant (who/where come from the session). */
export interface GrantDelegationInput {
  capabilityId: string;
  resourceScope?: AgentDelegationResourceScope;
  /** ISO-8601 expiry. */
  expiresAt?: string;
}

/** The body of agent creation. */
export interface CreateAgentInput {
  definitionId: string;
  name: string;
  description?: string;
}

function scopeSuffix(scope: AgentIdentityScope): string {
  const params = new URLSearchParams({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });
  return `?${params.toString()}`;
}

function post<T>(path: string, scope: AgentIdentityScope, body: unknown): Promise<T> {
  return api<T>(`${path}${scopeSuffix(scope)}`, { method: 'POST', body: JSON.stringify(body) });
}

const agentPath = (agentId: string): string => `/agents/${encodeURIComponent(agentId)}`;

/**
 * Lists the workspace's agents. `GET /api/agents` returns one authority view
 * per agent (`{agent, delegations, effectiveCapabilityIds, …}`); the list
 * shows the agent records and the inspect call re-reads a single view.
 */
export async function listAgents(scope: AgentIdentityScope): Promise<AgentIdentityDto[]> {
  const result = await api<{ agents: readonly Pick<AgentAuthorityDto, 'agent'>[] }>(
    `/agents${scopeSuffix(scope)}`,
  );
  return result.agents.map((view) => view.agent);
}

/** Creates an agent identity. */
export async function createAgent(
  scope: AgentIdentityScope,
  input: CreateAgentInput,
): Promise<AgentIdentityDto> {
  const result = await post<{ agent: AgentIdentityDto }>('/agents', scope, {
    definitionId: input.definitionId,
    name: input.name,
    ...(input.description === undefined || input.description === ''
      ? {}
      : { description: input.description }),
  });
  return result.agent;
}

/** Inspects an agent's authority (delegations + effective capabilities). */
export async function inspectAgent(
  scope: AgentIdentityScope,
  agentId: string,
): Promise<AgentAuthorityDto> {
  return api<AgentAuthorityDto>(`${agentPath(agentId)}${scopeSuffix(scope)}`);
}

/** Changes an agent's status. */
export async function setAgentStatus(
  scope: AgentIdentityScope,
  agentId: string,
  action: 'suspend' | 'reactivate' | 'revoke',
  reason?: string,
): Promise<{ agent: AgentIdentityDto; changed: boolean }> {
  return post(`${agentPath(agentId)}/${action}`, scope, reason ? { reason } : {});
}

/** Grants ONE capability delegation to an agent. */
export async function grantDelegation(
  scope: AgentIdentityScope,
  agentId: string,
  input: GrantDelegationInput,
): Promise<AgentDelegationDto> {
  const result = await post<{ delegation: AgentDelegationDto }>(
    `${agentPath(agentId)}/delegations`,
    scope,
    {
      capabilityId: input.capabilityId,
      ...(input.resourceScope === undefined ? {} : { resourceScope: input.resourceScope }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    },
  );
  return result.delegation;
}

/** Revokes a delegation (kept as historical evidence). */
export async function revokeDelegation(
  scope: AgentIdentityScope,
  agentId: string,
  delegationId: string,
  reason?: string,
): Promise<{ delegation: AgentDelegationDto; changed: boolean }> {
  return post(
    `${agentPath(agentId)}/delegations/${encodeURIComponent(delegationId)}/revoke`,
    scope,
    reason ? { reason } : {},
  );
}
