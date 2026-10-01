/**
 * @nexora/app-api — PostgreSQL agent-execution recorder (S26 Phase 8).
 *
 * The DURABLE implementation of the `@nexora/module-agents`
 * {@link AgentExecutionRecorder} port: journals one row per governed
 * business-agent run into `agent_executions` and lists the caller's recent
 * runs. Only trusted relational columns are stored (identity/scope live in
 * columns, never in payload); reads are always tenant + user scoped so one
 * user's runs can never leak into another's agent view.
 */

import { desc, eq, and } from 'drizzle-orm';
import { agentExecutions, type NexoraDatabase } from '@nexora/persistence';
import type { AgentExecutionRecord, AgentExecutionStatus } from '@nexora/contracts/agent';
import type { AgentExecutionRecorder, BusinessAgentContext } from '@nexora/module-agents';

type AgentExecutionRow = typeof agentExecutions.$inferSelect;

/** Converts a persisted timestamp to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Maps a persisted row to an {@link AgentExecutionRecord}. */
function rowToRecord(row: AgentExecutionRow): AgentExecutionRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    roleId: row.roleId,
    domainId: row.domainId,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId ?? undefined,
    userId: row.userId,
    proposalId: row.proposalId ?? undefined,
    proposalAction: row.proposalAction ?? undefined,
    status: row.status as AgentExecutionStatus,
    runId: row.runId ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: toIso(row.createdAt),
    // Phase 10 remediation linkage (the plan console's "what happened").
    planId: row.planId ?? undefined,
    stepId: row.stepId ?? undefined,
    problemId: row.problemId ?? undefined,
    // Prompt 4: WHICH agent (principal) ran, under which delegations.
    ...(row.agentIdentityId === null ? {} : { agentIdentityId: row.agentIdentityId }),
    ...(row.approvalId === null ? {} : { approvalId: row.approvalId }),
    ...(row.delegationIds === null
      ? {}
      : { delegationIds: row.delegationIds as readonly string[] }),
  };
}

/** The PostgreSQL {@link AgentExecutionRecorder}. */
export class PgAgentExecutionRecorder implements AgentExecutionRecorder {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async record(record: AgentExecutionRecord): Promise<void> {
    await this.#db.insert(agentExecutions).values({
      id: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      workspaceId: record.workspaceId ?? null,
      agentId: record.agentId,
      roleId: record.roleId,
      domainId: record.domainId,
      proposalId: record.proposalId ?? null,
      proposalAction: record.proposalAction ?? null,
      status: record.status,
      runId: record.runId ?? null,
      reason: record.reason ?? null,
      planId: record.planId ?? null,
      stepId: record.stepId ?? null,
      problemId: record.problemId ?? null,
      agentIdentityId: record.agentIdentityId ?? null,
      approvalId: record.approvalId ?? null,
      delegationIds: record.delegationIds === undefined ? null : [...record.delegationIds],
      createdAt: new Date(record.createdAt),
    });
  }

  async listRecent(
    context: BusinessAgentContext,
    limit: number,
  ): Promise<readonly AgentExecutionRecord[]> {
    const rows = await this.#db
      .select()
      .from(agentExecutions)
      .where(
        and(
          eq(agentExecutions.tenantId, context.tenantId),
          eq(agentExecutions.userId, context.userId),
        ),
      )
      .orderBy(desc(agentExecutions.createdAt))
      .limit(limit);
    return rows.map(rowToRecord);
  }

  async listByTenant(
    tenantId: string,
    options: { workspaceId?: string; limit: number },
  ): Promise<readonly AgentExecutionRecord[]> {
    const conditions = [eq(agentExecutions.tenantId, tenantId)];
    if (options.workspaceId !== undefined) {
      conditions.push(eq(agentExecutions.workspaceId, options.workspaceId));
    }
    const rows = await this.#db
      .select()
      .from(agentExecutions)
      .where(and(...conditions))
      .orderBy(desc(agentExecutions.createdAt))
      .limit(options.limit);
    return rows.map(rowToRecord);
  }
}
