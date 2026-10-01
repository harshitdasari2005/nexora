/**
 * @nexora/module-agents — agent authority evaluation (Prompt 4).
 *
 * The ONE deterministic rule that decides whether an agent may exercise a
 * capability for a given invocation. Pure (no I/O): the caller loads the
 * agent, its delegations, and the CURRENT authority of the humans involved,
 * and passes an explicit `now`. The same function runs at planning time
 * (to bound discovery) and — authoritatively — at EXECUTION time for every
 * tool invocation, so a delegation revoked or expired after a plan or an
 * approval can never execute.
 *
 *   effective(capability, resources) =
 *       agent exists ∧ agent.status == active
 *     ∧ agent.organization == run.organization ∧ agent.workspace == run.workspace
 *     ∧ capability ∉ NON_DELEGABLE
 *     ∧ capability ∈ definition ceiling
 *     ∧ capability ∈ initiating user's current authority
 *     ∧ ∃ delegation d for (agent, capability) in the same org + workspace:
 *           d.status == active ∧ (d.expiresAt == ∅ ∨ now < d.expiresAt)
 *         ∧ capability ∈ grantor's current authority
 *         ∧ scope(d) covers every resource the invocation touches
 *
 * An agent NEVER inherits the initiating user's or its owner's authority:
 * user authority is only an upper bound intersected with explicit grants.
 */

import type {
  AgentDelegation,
  AgentDelegationEffectiveStatus,
  AgentPrincipal,
  AgentResourceScope,
} from '@nexora/contracts/agent';

/**
 * Capabilities that are human-only and can never be delegated to an agent:
 * deciding approvals (an agent must never approve its own — or any —
 * sensitive action) and managing agents/delegations (no agent can grant
 * authority, to itself or to another agent), and reading or changing the
 * central policy configuration (AI is not authority — it cannot administer
 * the rules that constrain it). Both the business-permission
 * ids and any executable id with the same meaning are listed.
 */
export const NON_DELEGABLE_CAPABILITIES: readonly string[] = [
  'approvals.decide',
  'agents.manage',
  'agents.delegate',
  'audit.read',
  'policy.read',
  'policy.manage',
];

/** Why an agent was denied a capability (stable, audited). */
export type AgentAuthorityDenial =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_SUSPENDED'
  | 'AGENT_REVOKED'
  | 'AGENT_OUT_OF_SCOPE'
  | 'CAPABILITY_NOT_DELEGABLE'
  | 'CAPABILITY_OUTSIDE_AGENT_DEFINITION'
  | 'INITIATOR_LACKS_CAPABILITY'
  | 'DELEGATION_MISSING'
  | 'CAPABILITY_OUTSIDE_DELEGATION'
  | 'DELEGATION_REVOKED'
  | 'DELEGATION_EXPIRED'
  | 'DELEGATION_GRANTOR_LACKS_CAPABILITY'
  | 'DELEGATION_RESOURCE_OUT_OF_SCOPE';

/** The resources an invocation touches, as resolved by trusted server code. */
export type InvocationResources =
  /** The invocation provably touches these resources (possibly none). */
  | { kind: 'resolved'; resources: readonly AgentResourceScope[] }
  /** The resources could not be determined (unknown/ambiguous) — fails closed for scoped grants. */
  | { kind: 'unresolvable'; reason: string };

/** Everything {@link evaluateAgentAuthority} needs, loaded by the caller. */
export interface AgentAuthorityInput {
  /** The persisted agent, or `undefined` when no such agent exists. */
  agent: AgentPrincipal | undefined;
  /** The trusted scope of the run. */
  run: { organizationId: string; workspaceId?: string; initiatingUserId: string };
  /** The capability being exercised. */
  capabilityId: string;
  /** The resources the invocation touches. */
  resources: InvocationResources;
  /** The agent's delegations (any status; filtered here). */
  delegations: readonly AgentDelegation[];
  /** The agent definition's capability ceiling, or `undefined` when unknown. */
  definitionCapabilityIds: readonly string[] | undefined;
  /** The initiating user's CURRENT executable capabilities in the run's workspace. */
  initiatorCapabilityIds: readonly string[];
  /** A grantor's CURRENT executable capabilities in the delegation's workspace. */
  grantorCapabilityIds: (grantorUserId: string) => readonly string[];
  /** The evaluation instant (execution time). */
  now: Date;
}

/** The decision of {@link evaluateAgentAuthority}. */
export type AgentAuthorityDecision =
  | { ok: true; delegation: AgentDelegation }
  | { ok: false; denial: AgentAuthorityDenial; reason: string };

/** The effective status of a delegation at `now` (expiry is derived, never stored). */
export function delegationEffectiveStatus(
  delegation: AgentDelegation,
  now: Date,
): AgentDelegationEffectiveStatus {
  if (delegation.status === 'revoked') {
    return 'revoked';
  }
  if (delegation.expiresAt !== undefined && now.getTime() >= Date.parse(delegation.expiresAt)) {
    return 'expired';
  }
  return 'active';
}

/** Whether a delegation's resource scope covers every resource the invocation touches. */
export function scopeCovers(
  scope: AgentResourceScope | undefined,
  resources: InvocationResources,
): boolean {
  if (scope === undefined) {
    // Workspace-wide grant: tenant + workspace + capability already bound it.
    return true;
  }
  if (resources.kind === 'unresolvable') {
    return false;
  }
  const relevant = resources.resources.filter((resource) => resource.kind === scope.kind);
  // A scoped grant requires positive proof the invocation stays inside it:
  // it must touch at least one resource of the scoped kind, and only that one.
  return relevant.length > 0 && relevant.every((resource) => resource.id === scope.id);
}

/** Evaluates an agent's authority for one capability (see module docs). */
export function evaluateAgentAuthority(input: AgentAuthorityInput): AgentAuthorityDecision {
  const { agent, run, capabilityId } = input;
  if (agent === undefined) {
    return deny('AGENT_NOT_FOUND', 'no such agent in this organization');
  }
  if (agent.status === 'suspended') {
    return deny('AGENT_SUSPENDED', 'the agent is suspended');
  }
  if (agent.status === 'revoked') {
    return deny('AGENT_REVOKED', 'the agent is revoked');
  }
  if (agent.organizationId !== run.organizationId || agent.workspaceId !== run.workspaceId) {
    return deny('AGENT_OUT_OF_SCOPE', "the run is outside the agent's organization/workspace");
  }
  if (NON_DELEGABLE_CAPABILITIES.includes(capabilityId)) {
    return deny('CAPABILITY_NOT_DELEGABLE', `${capabilityId} is human-only`);
  }
  if (
    input.definitionCapabilityIds === undefined ||
    !input.definitionCapabilityIds.includes(capabilityId)
  ) {
    return deny(
      'CAPABILITY_OUTSIDE_AGENT_DEFINITION',
      `${capabilityId} is outside the agent definition's capability ceiling`,
    );
  }
  if (!input.initiatorCapabilityIds.includes(capabilityId)) {
    return deny(
      'INITIATOR_LACKS_CAPABILITY',
      `the initiating user does not currently hold ${capabilityId}`,
    );
  }

  const candidates = input.delegations.filter(
    (delegation) =>
      delegation.agentId === agent.id &&
      delegation.capabilityId === capabilityId &&
      delegation.organizationId === agent.organizationId &&
      delegation.workspaceId === agent.workspaceId,
  );
  if (candidates.length === 0) {
    const hasAnyGrant = input.delegations.some((delegation) => delegation.agentId === agent.id);
    return hasAnyGrant
      ? deny(
          'CAPABILITY_OUTSIDE_DELEGATION',
          `${capabilityId} is outside the capabilities delegated to this agent`,
        )
      : deny('DELEGATION_MISSING', 'the agent has no delegated capabilities');
  }

  // Report the most specific reason when nothing qualifies.
  let sawActive = false;
  let sawExpired = false;
  let sawGrantorLoss = false;
  let sawScopeMismatch = false;
  for (const delegation of sortById(candidates)) {
    const status = delegationEffectiveStatus(delegation, input.now);
    if (status === 'revoked') {
      continue;
    }
    if (status === 'expired') {
      sawExpired = true;
      continue;
    }
    sawActive = true;
    if (!input.grantorCapabilityIds(delegation.grantedByUserId).includes(capabilityId)) {
      sawGrantorLoss = true;
      continue;
    }
    if (!scopeCovers(delegation.resourceScope, input.resources)) {
      sawScopeMismatch = true;
      continue;
    }
    return { ok: true, delegation };
  }
  if (sawScopeMismatch) {
    return deny(
      'DELEGATION_RESOURCE_OUT_OF_SCOPE',
      input.resources.kind === 'unresolvable'
        ? `the resource could not be verified against the delegation scope (${input.resources.reason})`
        : 'the resource is outside the delegation scope',
    );
  }
  if (sawGrantorLoss) {
    return deny(
      'DELEGATION_GRANTOR_LACKS_CAPABILITY',
      `the delegating user no longer holds ${capabilityId}`,
    );
  }
  if (sawExpired && !sawActive) {
    return deny('DELEGATION_EXPIRED', `the delegation of ${capabilityId} has expired`);
  }
  return deny('DELEGATION_REVOKED', `the delegation of ${capabilityId} was revoked`);
}

/** The capabilities an agent could exercise right now (for discovery bounding / display). */
export function effectiveAgentCapabilities(
  input: Omit<AgentAuthorityInput, 'capabilityId' | 'resources'>,
): readonly string[] {
  const capabilities = new Set(input.delegations.map((delegation) => delegation.capabilityId));
  return [...capabilities]
    .filter((capabilityId) => {
      // Resource scope is enforced per invocation; for the capability SET a
      // scoped grant counts (its scope is re-checked at execution time).
      const decision = evaluateAgentAuthority({
        ...input,
        capabilityId,
        resources: { kind: 'resolved', resources: [] },
      });
      return decision.ok || decision.denial === 'DELEGATION_RESOURCE_OUT_OF_SCOPE';
    })
    .sort();
}

function deny(denial: AgentAuthorityDenial, reason: string): AgentAuthorityDecision {
  return { ok: false, denial, reason };
}

function sortById(delegations: readonly AgentDelegation[]): AgentDelegation[] {
  return [...delegations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
