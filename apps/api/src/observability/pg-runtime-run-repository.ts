/**
 * @nexora/app-api — PostgreSQL runtime run repository (Prompt 7).
 *
 * INSERT-ONLY: there is no update or delete path. Every read is tenant-scoped;
 * a foreign run id is indistinguishable from a missing one.
 */

import { and, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import { runtimeRuns, type NexoraDatabase } from '@nexora/persistence';
import type {
  RuntimeRun,
  RuntimeRunQuery,
  RuntimeRunRepository,
} from '@nexora/module-observability';

/** PostgreSQL {@link RuntimeRunRepository}. */
export class PgRuntimeRunRepository implements RuntimeRunRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async append(run: RuntimeRun): Promise<void> {
    await this.#db.insert(runtimeRuns).values({
      id: run.id,
      tenantId: run.tenantId,
      workspaceId: run.workspaceId ?? null,
      requestId: run.requestId ?? null,
      correlationId: run.correlationId ?? null,
      actorId: run.actorId,
      agentId: run.agentId ?? null,
      delegationId: run.delegationId ?? null,
      origin: run.origin,
      startedAt: new Date(run.startedAt),
      endedAt: new Date(run.endedAt),
      durationMs: run.durationMs,
      status: run.status,
      failureStage: run.failure?.stage ?? null,
      failureCode: run.failure?.code ?? null,
      failureClass: run.failure?.class ?? null,
      provider: run.provider ?? null,
      model: run.model ?? null,
      modelExecution: run.modelExecution ?? null,
      verified: run.verified ?? null,
      tokensAvailable: run.tokenUsage.available,
      totalTokens: run.tokenUsage.totalTokens,
      cost: run.cost.estimated,
      record: run as never,
    });
  }

  async list(tenantId: string, query: RuntimeRunQuery = {}): Promise<readonly RuntimeRun[]> {
    const conditions: SQL[] = [eq(runtimeRuns.tenantId, tenantId)];
    if (query.workspaceId !== undefined)
      conditions.push(eq(runtimeRuns.workspaceId, query.workspaceId));
    if (query.status !== undefined) conditions.push(eq(runtimeRuns.status, query.status));
    if (query.failureStage !== undefined)
      conditions.push(eq(runtimeRuns.failureStage, query.failureStage));
    if (query.failureClass !== undefined)
      conditions.push(eq(runtimeRuns.failureClass, query.failureClass));
    if (query.provider !== undefined) conditions.push(eq(runtimeRuns.provider, query.provider));
    if (query.model !== undefined) conditions.push(eq(runtimeRuns.model, query.model));
    if (query.agentId !== undefined) conditions.push(eq(runtimeRuns.agentId, query.agentId));
    if (query.actorId !== undefined) conditions.push(eq(runtimeRuns.actorId, query.actorId));
    if (query.origin !== undefined) conditions.push(eq(runtimeRuns.origin, query.origin));
    if (query.requestId !== undefined) conditions.push(eq(runtimeRuns.requestId, query.requestId));
    // Correlation filters are jsonb containment predicates over the stored record
    // (no migration). They always ride on the indexed tenant predicate, so the
    // scan is bounded to one tenant's runs; add a GIN index on `record` if a
    // tenant's run volume ever makes these slow.
    if (query.approvalId !== undefined) {
      const byApproval = JSON.stringify({ approval: { approvalId: query.approvalId } });
      const byTool = JSON.stringify({ tools: [{ approvalId: query.approvalId }] });
      conditions.push(
        or(
          sql`${runtimeRuns.record} @> ${byApproval}::jsonb`,
          sql`${runtimeRuns.record} @> ${byTool}::jsonb`,
        ) as SQL,
      );
    }
    if (query.invocationId !== undefined) {
      const byInvocation = JSON.stringify({ tools: [{ invocationId: query.invocationId }] });
      conditions.push(sql`${runtimeRuns.record} @> ${byInvocation}::jsonb`);
    }
    if (query.from !== undefined) conditions.push(gte(runtimeRuns.startedAt, new Date(query.from)));
    if (query.to !== undefined) conditions.push(lte(runtimeRuns.startedAt, new Date(query.to)));
    const rows = await this.#db
      .select({ record: runtimeRuns.record })
      .from(runtimeRuns)
      .where(and(...conditions))
      .orderBy(desc(runtimeRuns.startedAt), desc(runtimeRuns.id))
      .limit(query.limit ?? 100);
    return rows.map((row) => row.record as RuntimeRun);
  }

  async get(tenantId: string, runId: string): Promise<RuntimeRun | undefined> {
    const rows = await this.#db
      .select({ record: runtimeRuns.record })
      .from(runtimeRuns)
      .where(and(eq(runtimeRuns.tenantId, tenantId), eq(runtimeRuns.id, runId)))
      .limit(1);
    return rows[0] === undefined ? undefined : (rows[0].record as RuntimeRun);
  }
}
