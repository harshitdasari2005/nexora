/**
 * @nexora/app-api — PostgreSQL agent identity + delegation repositories
 * (Prompt 4).
 *
 * Every read is tenant-scoped (`organization_id` predicate): an agent or
 * delegation id from another organization resolves to nothing. Writes are
 * upserts by id — nothing is ever deleted; revocation and suspension are
 * state changes that preserve the historical record.
 */

import { and, asc, eq } from 'drizzle-orm';
import { agentDelegations, agents, type NexoraDatabase } from '@nexora/persistence';
import type {
  AgentDelegation,
  AgentDelegationStatus,
  AgentPrincipal,
  AgentResourceScope,
  AgentStatus,
} from '@nexora/contracts/agent';
import type { AgentDelegationRepository, AgentIdentityRepository } from '@nexora/module-agents';

type AgentRow = typeof agents.$inferSelect;
type DelegationRow = typeof agentDelegations.$inferSelect;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function rowToAgent(row: AgentRow): AgentPrincipal {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    definitionId: row.definitionId,
    name: row.name,
    description: row.description,
    status: row.status as AgentStatus,
    ownerUserId: row.ownerUserId,
    createdBy: row.createdBy,
    ...(row.statusChangedBy === null ? {} : { statusChangedBy: row.statusChangedBy }),
    ...(row.statusReason === null ? {} : { statusReason: row.statusReason }),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function rowToDelegation(row: DelegationRow): AgentDelegation {
  const scope = row.resourceScope as AgentResourceScope | null;
  const metadata = row.metadata as Record<string, unknown> | null;
  return {
    id: row.id,
    agentId: row.agentId,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    grantedByUserId: row.grantedByUserId,
    capabilityId: row.capabilityId,
    ...(scope === null ? {} : { resourceScope: scope }),
    status: row.status as AgentDelegationStatus,
    createdAt: toIso(row.createdAt),
    ...(row.expiresAt === null ? {} : { expiresAt: toIso(row.expiresAt) }),
    ...(row.revokedAt === null ? {} : { revokedAt: toIso(row.revokedAt) }),
    ...(row.revokedBy === null ? {} : { revokedBy: row.revokedBy }),
    ...(row.revokeReason === null ? {} : { revokeReason: row.revokeReason }),
    ...(metadata === null || Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

/** PostgreSQL {@link AgentIdentityRepository}. */
export class PgAgentIdentityRepository implements AgentIdentityRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(organizationId: string, agentId: string): Promise<AgentPrincipal | undefined> {
    const rows = await this.#db
      .select()
      .from(agents)
      .where(and(eq(agents.organizationId, organizationId), eq(agents.id, agentId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToAgent(row);
  }

  async listByWorkspace(
    organizationId: string,
    workspaceId: string,
  ): Promise<readonly AgentPrincipal[]> {
    const rows = await this.#db
      .select()
      .from(agents)
      .where(and(eq(agents.organizationId, organizationId), eq(agents.workspaceId, workspaceId)))
      .orderBy(asc(agents.createdAt), asc(agents.id));
    return rows.map(rowToAgent);
  }

  async save(agent: AgentPrincipal): Promise<void> {
    const row = {
      id: agent.id,
      organizationId: agent.organizationId,
      workspaceId: agent.workspaceId,
      definitionId: agent.definitionId,
      name: agent.name,
      description: agent.description,
      status: agent.status,
      ownerUserId: agent.ownerUserId,
      createdBy: agent.createdBy,
      statusChangedBy: agent.statusChangedBy ?? null,
      statusReason: agent.statusReason ?? null,
      createdAt: new Date(agent.createdAt),
      updatedAt: new Date(agent.updatedAt),
    };
    await this.#db
      .insert(agents)
      .values(row)
      .onConflictDoUpdate({
        target: agents.id,
        // Identity, scope, definition, and creation facts are immutable.
        set: {
          name: row.name,
          description: row.description,
          status: row.status,
          ownerUserId: row.ownerUserId,
          statusChangedBy: row.statusChangedBy,
          statusReason: row.statusReason,
          updatedAt: row.updatedAt,
        },
      });
  }
}

/** PostgreSQL {@link AgentDelegationRepository}. */
export class PgAgentDelegationRepository implements AgentDelegationRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(
    organizationId: string,
    delegationId: string,
  ): Promise<AgentDelegation | undefined> {
    const rows = await this.#db
      .select()
      .from(agentDelegations)
      .where(
        and(
          eq(agentDelegations.organizationId, organizationId),
          eq(agentDelegations.id, delegationId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToDelegation(row);
  }

  async listByAgent(organizationId: string, agentId: string): Promise<readonly AgentDelegation[]> {
    const rows = await this.#db
      .select()
      .from(agentDelegations)
      .where(
        and(
          eq(agentDelegations.organizationId, organizationId),
          eq(agentDelegations.agentId, agentId),
        ),
      )
      .orderBy(asc(agentDelegations.createdAt), asc(agentDelegations.id));
    return rows.map(rowToDelegation);
  }

  async save(delegation: AgentDelegation): Promise<void> {
    const row = {
      id: delegation.id,
      agentId: delegation.agentId,
      organizationId: delegation.organizationId,
      workspaceId: delegation.workspaceId,
      grantedByUserId: delegation.grantedByUserId,
      capabilityId: delegation.capabilityId,
      resourceScope: delegation.resourceScope ?? null,
      status: delegation.status,
      createdAt: new Date(delegation.createdAt),
      expiresAt: delegation.expiresAt === undefined ? null : new Date(delegation.expiresAt),
      revokedAt: delegation.revokedAt === undefined ? null : new Date(delegation.revokedAt),
      revokedBy: delegation.revokedBy ?? null,
      revokeReason: delegation.revokeReason ?? null,
      metadata: delegation.metadata ?? {},
      updatedAt: new Date(),
    };
    await this.#db
      .insert(agentDelegations)
      .values(row)
      .onConflictDoUpdate({
        target: agentDelegations.id,
        // The grant itself (who, what, where, scope, expiry) is immutable;
        // only the revocation facts may change.
        set: {
          status: row.status,
          revokedAt: row.revokedAt,
          revokedBy: row.revokedBy,
          revokeReason: row.revokeReason,
          updatedAt: row.updatedAt,
        },
      });
  }
}
