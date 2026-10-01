/**
 * @nexora/module-agents — agent identity + delegation management (Prompt 4).
 *
 * The application service behind agent management: create an agent
 * identity, grant it ONE capability at a time, revoke grants, and suspend /
 * reactivate / revoke the agent. Every operation:
 *
 * - runs under a TRUSTED actor context (authenticated user, membership-
 *   resolved organization + workspace, and the actor's CURRENT executable
 *   capability set) — built by the API from the session, never from input;
 * - is tenant + workspace scoped (a foreign agent or delegation id resolves
 *   to NOT FOUND);
 * - FAILS CLOSED with an explicit reason — a delegation that exceeds the
 *   granting user's authority is refused, never silently reduced;
 * - is published as an audit event (`agent.*`), and nothing is ever
 *   deleted: revocation and suspension preserve the historical record.
 *
 * The route layer additionally requires the `agents.manage` business
 * permission (RBAC) before any of these run.
 */

import { prefixedId } from '@nexora/shared/ids';
import {
  createEventEnvelope,
  type EventEnvelope,
  type EventPublisher,
} from '@nexora/shared/events';
import type {
  AgentDelegation,
  AgentDelegationEffectiveStatus,
  AgentPrincipal,
  AgentResourceScope,
  AgentStatus,
  BusinessAgentDefinition,
} from '@nexora/contracts/agent';

import {
  NON_DELEGABLE_CAPABILITIES,
  delegationEffectiveStatus,
  effectiveAgentCapabilities,
} from './authority.js';
import type { AgentDelegationRepository, AgentIdentityRepository } from './repositories.js';

/**
 * Which capabilities support a resource-scoped delegation, and of which
 * kind. A scope on any other capability is REFUSED (never ignored): the
 * runtime could not prove an invocation stays inside it.
 */
export const RESOURCE_SCOPED_CAPABILITIES: Readonly<Record<string, AgentResourceScope['kind']>> = {
  'projects.find_project': 'project',
  'projects.assign_employee': 'project',
  'workflow.hire_and_assign_employee': 'project',
  'finance.submit_expense': 'budget',
};

/** The longest a delegation may live (bounded authority by default). */
export const MAX_DELEGATION_DAYS = 90;

/** The trusted actor of a management operation (built server-side). */
export interface AgentManagementActor {
  /** The authenticated user. */
  userId: string;
  /** Membership-resolved organization. */
  organizationId: string;
  /** Membership-resolved workspace. */
  workspaceId: string;
  /** The actor's CURRENT executable capabilities in that workspace. */
  capabilityIds: readonly string[];
}

/** Verifies a resource exists inside an organization + workspace (trusted read). */
export type AgentResourceVerifier = (
  scope: AgentResourceScope,
  organizationId: string,
  workspaceId: string,
) => Promise<boolean>;

/** Loads a user's CURRENT executable capabilities in a workspace (trusted read). */
export type AgentCapabilityResolver = (input: {
  userId: string;
  organizationId: string;
  workspaceId: string;
}) => Promise<readonly string[]>;

/** Dependencies of {@link AgentIdentityService}. */
export interface AgentIdentityServiceDependencies {
  agents: AgentIdentityRepository;
  delegations: AgentDelegationRepository;
  /** Resolves agent definitions (the engine configuration + capability ceiling). */
  definitions: { get(id: string): BusinessAgentDefinition | undefined };
  /** Verifies resource scopes exist in the delegation's org + workspace. */
  verifyResource: AgentResourceVerifier;
  /** Current executable capabilities of a user (for grantor checks in views). */
  capabilitiesOf: AgentCapabilityResolver;
  /** Audit events. */
  publisher: EventPublisher;
  /** The authority clock (tests inject a fixed/advancing clock). */
  now?: () => Date;
}

/** Why a management operation was refused (stable; mapped to HTTP by the route). */
export type AgentManagementFailure =
  | 'AGENT_NOT_FOUND'
  | 'DELEGATION_NOT_FOUND'
  | 'AGENT_OUT_OF_SCOPE'
  | 'AGENT_NOT_ACTIVE'
  | 'AGENT_REVOKED'
  | 'UNKNOWN_DEFINITION'
  | 'INVALID_INPUT'
  | 'CAPABILITY_NOT_DELEGABLE'
  | 'CAPABILITY_OUTSIDE_AGENT_DEFINITION'
  | 'DELEGATION_EXCEEDS_USER_AUTHORITY'
  | 'RESOURCE_SCOPE_UNSUPPORTED'
  | 'RESOURCE_NOT_FOUND'
  | 'EXPIRY_INVALID';

/** A refused management operation. */
export interface AgentManagementError {
  ok: false;
  failure: AgentManagementFailure;
  message: string;
}

/** One delegation with its effective state at read time. */
export interface AgentDelegationView extends AgentDelegation {
  effectiveStatus: AgentDelegationEffectiveStatus;
}

/** An agent with its delegations and the capabilities it could exercise now. */
export interface AgentAuthorityView {
  agent: AgentPrincipal;
  delegations: readonly AgentDelegationView[];
  /**
   * Capabilities the agent could exercise RIGHT NOW for its owner-independent
   * grants (definition ceiling ∩ active, unexpired delegations whose grantor
   * still holds the capability). A run is further intersected with the
   * initiating user's authority and resource scope at execution time.
   */
  effectiveCapabilityIds: readonly string[];
  /** The definition's capability ceiling (what COULD ever be delegated). */
  definitionCapabilityIds: readonly string[];
}

type Outcome<T> = ({ ok: true } & T) | AgentManagementError;

/** The agent identity + delegation management service. */
export class AgentIdentityService {
  readonly #deps: AgentIdentityServiceDependencies;
  readonly #now: () => Date;

  constructor(dependencies: AgentIdentityServiceDependencies) {
    this.#deps = dependencies;
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** The authority clock (shared with execution-time checks). */
  now(): Date {
    return this.#now();
  }

  /** Creates an agent identity in the actor's workspace. Grants NOTHING. */
  async createAgent(
    actor: AgentManagementActor,
    input: { definitionId: string; name: string; description?: string; ownerUserId?: string },
  ): Promise<Outcome<{ agent: AgentPrincipal }>> {
    const definition = this.#deps.definitions.get(input.definitionId);
    if (definition === undefined) {
      return fail('UNKNOWN_DEFINITION', `Unknown agent definition: ${input.definitionId}`);
    }
    const name = input.name.trim();
    if (name.length === 0 || name.length > 120) {
      return fail('INVALID_INPUT', 'An agent name of 1–120 characters is required');
    }
    const at = this.#now().toISOString();
    const agent: AgentPrincipal = {
      id: prefixedId('agt'),
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      definitionId: definition.id,
      name,
      description: (input.description ?? definition.description).trim().slice(0, 2000),
      status: 'active',
      // Ownership is accountability, not authority: the owner is recorded,
      // and the agent still starts with ZERO delegated capabilities.
      ownerUserId: input.ownerUserId ?? actor.userId,
      createdBy: actor.userId,
      createdAt: at,
      updatedAt: at,
    };
    await this.#deps.agents.save(agent);
    await this.#publish(actor, agent, 'agent.created', {
      definitionId: agent.definitionId,
      name: agent.name,
      ownerUserId: agent.ownerUserId,
    });
    return { ok: true, agent };
  }

  /** Lists the agents of the actor's workspace with their authority views. */
  async listAgents(actor: AgentManagementActor): Promise<readonly AgentAuthorityView[]> {
    const agents = await this.#deps.agents.listByWorkspace(actor.organizationId, actor.workspaceId);
    return Promise.all(agents.map((agent) => this.#view(agent)));
  }

  /** Inspects one agent's authority (tenant + workspace scoped). */
  async inspectAgent(
    actor: AgentManagementActor,
    agentId: string,
  ): Promise<Outcome<{ view: AgentAuthorityView }>> {
    const agent = await this.#scopedAgent(actor, agentId);
    if (!agent.ok) return agent;
    return { ok: true, view: await this.#view(agent.agent) };
  }

  /**
   * Grants ONE capability to an agent. Refused (never reduced) unless ALL
   * hold: the agent is in the actor's workspace and active; the capability
   * is delegable, inside the agent definition's ceiling, and held by the
   * actor RIGHT NOW; a resource scope (when given) is supported for the
   * capability and names a resource that exists in this org + workspace; an
   * expiry (when given) is in the future and within {@link MAX_DELEGATION_DAYS}.
   */
  async grantDelegation(
    actor: AgentManagementActor,
    agentId: string,
    input: {
      capabilityId: string;
      resourceScope?: AgentResourceScope;
      expiresAt?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Outcome<{ delegation: AgentDelegation }>> {
    const scoped = await this.#scopedAgent(actor, agentId);
    if (!scoped.ok) return scoped;
    const agent = scoped.agent;
    if (agent.status !== 'active') {
      return fail(
        agent.status === 'revoked' ? 'AGENT_REVOKED' : 'AGENT_NOT_ACTIVE',
        `The agent is ${agent.status}; delegations can only be granted to an active agent`,
      );
    }
    const capabilityId = input.capabilityId.trim();
    if (capabilityId.length === 0) {
      return fail('INVALID_INPUT', 'A capability id is required');
    }
    if (NON_DELEGABLE_CAPABILITIES.includes(capabilityId)) {
      return fail(
        'CAPABILITY_NOT_DELEGABLE',
        `${capabilityId} is human-only and can never be delegated to an agent`,
      );
    }
    const definition = this.#deps.definitions.get(agent.definitionId);
    if (definition === undefined || !definition.capabilityIds.includes(capabilityId)) {
      return fail(
        'CAPABILITY_OUTSIDE_AGENT_DEFINITION',
        `${capabilityId} is outside what a ${agent.definitionId} agent can ever be delegated`,
      );
    }
    if (!actor.capabilityIds.includes(capabilityId)) {
      return fail(
        'DELEGATION_EXCEEDS_USER_AUTHORITY',
        `You do not hold ${capabilityId} in this workspace, so you cannot delegate it`,
      );
    }
    let resourceScope: AgentResourceScope | undefined;
    if (input.resourceScope !== undefined) {
      const supported = RESOURCE_SCOPED_CAPABILITIES[capabilityId];
      if (supported === undefined || supported !== input.resourceScope.kind) {
        return fail(
          'RESOURCE_SCOPE_UNSUPPORTED',
          `${capabilityId} cannot be restricted to a ${input.resourceScope.kind}`,
        );
      }
      const exists = await this.#deps.verifyResource(
        input.resourceScope,
        agent.organizationId,
        agent.workspaceId,
      );
      if (!exists) {
        return fail(
          'RESOURCE_NOT_FOUND',
          `The ${input.resourceScope.kind} is not in this organization/workspace`,
        );
      }
      resourceScope = { kind: input.resourceScope.kind, id: input.resourceScope.id };
    }
    const now = this.#now();
    let expiresAt: string | undefined;
    if (input.expiresAt !== undefined) {
      const expiry = Date.parse(input.expiresAt);
      if (Number.isNaN(expiry) || expiry <= now.getTime()) {
        return fail('EXPIRY_INVALID', 'The expiry must be a valid time in the future');
      }
      if (expiry - now.getTime() > MAX_DELEGATION_DAYS * 24 * 60 * 60 * 1000) {
        return fail('EXPIRY_INVALID', `A delegation may last at most ${MAX_DELEGATION_DAYS} days`);
      }
      expiresAt = new Date(expiry).toISOString();
    }
    const at = now.toISOString();
    const delegation: AgentDelegation = {
      id: prefixedId('dlg'),
      agentId: agent.id,
      organizationId: agent.organizationId,
      workspaceId: agent.workspaceId,
      grantedByUserId: actor.userId,
      capabilityId,
      ...(resourceScope === undefined ? {} : { resourceScope }),
      status: 'active',
      createdAt: at,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
    await this.#deps.delegations.save(delegation);
    await this.#publish(actor, agent, 'agent.delegation.granted', {
      delegationId: delegation.id,
      capabilityId,
      ...(resourceScope === undefined ? {} : { resourceScope }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    });
    return { ok: true, delegation };
  }

  /**
   * Revokes a delegation. Idempotent: revoking an already revoked delegation
   * succeeds with `changed: false` and publishes nothing. The record is kept.
   */
  async revokeDelegation(
    actor: AgentManagementActor,
    agentId: string,
    delegationId: string,
    reason?: string,
  ): Promise<Outcome<{ delegation: AgentDelegation; changed: boolean }>> {
    const scoped = await this.#scopedAgent(actor, agentId);
    if (!scoped.ok) return scoped;
    const delegation = await this.#deps.delegations.findById(actor.organizationId, delegationId);
    if (delegation === undefined || delegation.agentId !== scoped.agent.id) {
      return fail('DELEGATION_NOT_FOUND', 'Delegation not found');
    }
    if (delegation.status === 'revoked') {
      return { ok: true, delegation, changed: false };
    }
    const revoked: AgentDelegation = {
      ...delegation,
      status: 'revoked',
      revokedAt: this.#now().toISOString(),
      revokedBy: actor.userId,
      ...(reason === undefined || reason.trim().length === 0
        ? {}
        : { revokeReason: reason.trim().slice(0, 500) }),
    };
    await this.#deps.delegations.save(revoked);
    await this.#publish(actor, scoped.agent, 'agent.delegation.revoked', {
      delegationId: revoked.id,
      capabilityId: revoked.capabilityId,
    });
    return { ok: true, delegation: revoked, changed: true };
  }

  /**
   * Changes an agent's status. `revoked` is terminal (never reactivated);
   * setting the current status again is an idempotent no-op.
   */
  async setAgentStatus(
    actor: AgentManagementActor,
    agentId: string,
    status: AgentStatus,
    reason?: string,
  ): Promise<Outcome<{ agent: AgentPrincipal; changed: boolean }>> {
    const scoped = await this.#scopedAgent(actor, agentId);
    if (!scoped.ok) return scoped;
    const agent = scoped.agent;
    if (agent.status === status) {
      return { ok: true, agent, changed: false };
    }
    if (agent.status === 'revoked') {
      return fail('AGENT_REVOKED', 'A revoked agent cannot be reactivated or changed');
    }
    const updated: AgentPrincipal = {
      ...agent,
      status,
      statusChangedBy: actor.userId,
      ...(reason === undefined || reason.trim().length === 0
        ? {}
        : { statusReason: reason.trim().slice(0, 500) }),
      updatedAt: this.#now().toISOString(),
    };
    await this.#deps.agents.save(updated);
    const type =
      status === 'active'
        ? 'agent.reactivated'
        : status === 'suspended'
          ? 'agent.suspended'
          : 'agent.revoked';
    await this.#publish(actor, updated, type, { previousStatus: agent.status, status });
    return { ok: true, agent: updated, changed: true };
  }

  async #scopedAgent(
    actor: AgentManagementActor,
    agentId: string,
  ): Promise<Outcome<{ agent: AgentPrincipal }>> {
    const agent = await this.#deps.agents.findById(actor.organizationId, agentId);
    if (agent === undefined) {
      return fail('AGENT_NOT_FOUND', 'Agent not found');
    }
    if (agent.workspaceId !== actor.workspaceId) {
      // Another workspace's agent is managed from THAT workspace only.
      return fail('AGENT_NOT_FOUND', 'Agent not found');
    }
    return { ok: true, agent };
  }

  async #view(agent: AgentPrincipal): Promise<AgentAuthorityView> {
    const now = this.#now();
    const delegations = await this.#deps.delegations.listByAgent(agent.organizationId, agent.id);
    const definition = this.#deps.definitions.get(agent.definitionId);
    const grantors = new Map<string, readonly string[]>();
    for (const delegation of delegations) {
      if (!grantors.has(delegation.grantedByUserId)) {
        grantors.set(
          delegation.grantedByUserId,
          await this.#deps.capabilitiesOf({
            userId: delegation.grantedByUserId,
            organizationId: agent.organizationId,
            workspaceId: agent.workspaceId,
          }),
        );
      }
    }
    const effective = effectiveAgentCapabilities({
      agent,
      run: {
        organizationId: agent.organizationId,
        workspaceId: agent.workspaceId,
        // The view is the agent's own ceiling; a run intersects further
        // with ITS initiating user at execution time.
        initiatingUserId: agent.ownerUserId,
      },
      delegations,
      definitionCapabilityIds: definition?.capabilityIds,
      initiatorCapabilityIds: definition?.capabilityIds ?? [],
      grantorCapabilityIds: (userId) => grantors.get(userId) ?? [],
      now,
    });
    return {
      agent,
      delegations: delegations.map((delegation) => ({
        ...delegation,
        effectiveStatus: delegationEffectiveStatus(delegation, now),
      })),
      effectiveCapabilityIds: effective,
      definitionCapabilityIds: [...(definition?.capabilityIds ?? [])],
    };
  }

  async #publish(
    actor: AgentManagementActor,
    agent: AgentPrincipal,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: EventEnvelope = createEventEnvelope({
      type,
      version: 1,
      tenantId: agent.organizationId,
      workspaceId: agent.workspaceId,
      correlationId: agent.id,
      actor: { kind: 'user', id: actor.userId },
      payload: { agentId: agent.id, agentName: agent.name, ...payload },
    });
    try {
      await this.#deps.publisher.publish([event]);
    } catch {
      // Audit publication is best-effort; the state change already committed.
    }
  }
}

function fail(failure: AgentManagementFailure, message: string): AgentManagementError {
  return { ok: false, failure, message };
}
