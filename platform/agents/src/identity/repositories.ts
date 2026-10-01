/**
 * @nexora/module-agents — agent identity + delegation persistence ports.
 *
 * The API composes PostgreSQL implementations; the in-memory ones back unit
 * tests and the evaluation harness. Every read is tenant-scoped: an agent or
 * delegation id from another organization resolves to NOTHING. Nothing is
 * ever deleted — revocation and suspension are state changes that keep the
 * historical record.
 */

import type { AgentDelegation, AgentPrincipal } from '@nexora/contracts/agent';

/** Persistence port of {@link AgentPrincipal}. */
export interface AgentIdentityRepository {
  /** Loads an agent by id WITHIN an organization (foreign ids → undefined). */
  findById(organizationId: string, agentId: string): Promise<AgentPrincipal | undefined>;
  /** Lists the agents of a workspace (any status). */
  listByWorkspace(organizationId: string, workspaceId: string): Promise<readonly AgentPrincipal[]>;
  /** Inserts or updates by id. */
  save(agent: AgentPrincipal): Promise<void>;
}

/** Persistence port of {@link AgentDelegation}. */
export interface AgentDelegationRepository {
  /** Loads a delegation by id WITHIN an organization (foreign ids → undefined). */
  findById(organizationId: string, delegationId: string): Promise<AgentDelegation | undefined>;
  /** Every delegation of an agent (any status) within its organization. */
  listByAgent(organizationId: string, agentId: string): Promise<readonly AgentDelegation[]>;
  /** Inserts or updates by id. */
  save(delegation: AgentDelegation): Promise<void>;
}

/** In-memory {@link AgentIdentityRepository} (tests, evaluation harness). */
export class InMemoryAgentIdentityRepository implements AgentIdentityRepository {
  readonly agents = new Map<string, AgentPrincipal>();

  async findById(organizationId: string, agentId: string): Promise<AgentPrincipal | undefined> {
    const agent = this.agents.get(agentId);
    return agent !== undefined && agent.organizationId === organizationId
      ? { ...agent }
      : undefined;
  }

  async listByWorkspace(
    organizationId: string,
    workspaceId: string,
  ): Promise<readonly AgentPrincipal[]> {
    return [...this.agents.values()]
      .filter(
        (agent) => agent.organizationId === organizationId && agent.workspaceId === workspaceId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((agent) => ({ ...agent }));
  }

  async save(agent: AgentPrincipal): Promise<void> {
    this.agents.set(agent.id, { ...agent });
  }
}

/** In-memory {@link AgentDelegationRepository} (tests, evaluation harness). */
export class InMemoryAgentDelegationRepository implements AgentDelegationRepository {
  readonly delegations = new Map<string, AgentDelegation>();

  async findById(
    organizationId: string,
    delegationId: string,
  ): Promise<AgentDelegation | undefined> {
    const delegation = this.delegations.get(delegationId);
    return delegation !== undefined && delegation.organizationId === organizationId
      ? { ...delegation }
      : undefined;
  }

  async listByAgent(organizationId: string, agentId: string): Promise<readonly AgentDelegation[]> {
    return [...this.delegations.values()]
      .filter(
        (delegation) =>
          delegation.organizationId === organizationId && delegation.agentId === agentId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((delegation) => ({ ...delegation }));
  }

  async save(delegation: AgentDelegation): Promise<void> {
    this.delegations.set(delegation.id, { ...delegation });
  }
}
