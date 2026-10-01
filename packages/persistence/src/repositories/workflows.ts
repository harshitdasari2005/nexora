/**
 * @nexora/persistence — workflow repositories.
 *
 * Drizzle implementations of the workflow module repository ports
 * (`WorkflowInstanceRepository`, `WorkflowStepExecutionRepository`).
 * Aggregates are serialized via `snapshot()` and reconstructed via
 * `hydrate()` (PERSISTENCE.md §4 aggregate ownership). Every read is
 * tenant-scoped — a caller can never list or load another tenant's workflow
 * state, and the step-journal `executionKey` unique constraint backs
 * idempotent execution (a duplicate delivery can never insert a second
 * attempt row for the same (workflow, step, attempt)).
 */

import { and, eq } from 'drizzle-orm';
import type { TenantId } from '@nexora/contracts/common';
import type {
  WorkflowInstanceRepository,
  WorkflowStepExecutionRepository,
} from '@nexora/module-workflow';
import { WorkflowInstance, WorkflowStepExecution } from '@nexora/module-workflow';

import type { NexoraDatabase } from '../db.js';
import { workflowInstances, workflowStepExecutions } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

type WorkflowInstanceRow = typeof workflowInstances.$inferSelect;
type WorkflowStepExecutionRow = typeof workflowStepExecutions.$inferSelect;

/** Maps a workflow_instances row to a {@link WorkflowInstance} snapshot. */
function rowToWorkflowSnapshot(
  row: WorkflowInstanceRow,
): ReturnType<typeof WorkflowInstance.snapshot> {
  return {
    id: row.id,
    definitionId: row.definitionId,
    definitionKey: row.definitionKey,
    definitionVersion: row.definitionVersion,
    tenantId: row.tenantId,
    userId: row.userId,
    workspaceId: row.workspaceId ?? undefined,
    correlationId: row.correlationId,
    status: row.status as ReturnType<typeof WorkflowInstance.snapshot>['status'],
    input: row.input as Record<string, unknown>,
    state: (row.state as Record<string, unknown>) ?? {},
    output: (row.output as Record<string, unknown> | undefined) ?? undefined,
    error: row.error ?? undefined,
    currentStepId: row.currentStepId ?? undefined,
    startedAt: toIso(row.startedAt),
    finishedAt: row.finishedAt === null ? undefined : toIso(row.finishedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
    ...(row.origin === null ? {} : { origin: row.origin }),
    ...(row.agentId === null ? {} : { agentId: row.agentId }),
    ...(row.delegationId === null ? {} : { delegationId: row.delegationId }),
    ...(row.approvalId === null ? {} : { approvalId: row.approvalId }),
    ...(row.allowedCapabilityIds === null || !Array.isArray(row.allowedCapabilityIds)
      ? {}
      : { allowedCapabilityIds: row.allowedCapabilityIds as string[] }),
  };
}

/** Maps a {@link WorkflowInstance} snapshot to a workflow_instances row. */
function workflowSnapshotToRow(
  snapshot: ReturnType<typeof WorkflowInstance.snapshot>,
): WorkflowInstanceRow {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    definitionId: snapshot.definitionId,
    definitionKey: snapshot.definitionKey,
    definitionVersion: snapshot.definitionVersion,
    userId: snapshot.userId,
    workspaceId: snapshot.workspaceId ?? null,
    correlationId: snapshot.correlationId,
    status: snapshot.status,
    input: snapshot.input,
    state: snapshot.state,
    output: snapshot.output ?? null,
    error: snapshot.error ?? null,
    currentStepId: snapshot.currentStepId ?? null,
    startedAt: toDate(snapshot.startedAt),
    finishedAt: snapshot.finishedAt === undefined ? null : toDate(snapshot.finishedAt),
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
    origin: snapshot.origin ?? null,
    agentId: snapshot.agentId ?? null,
    delegationId: snapshot.delegationId ?? null,
    approvalId: snapshot.approvalId ?? null,
    allowedCapabilityIds:
      snapshot.allowedCapabilityIds === undefined ? null : [...snapshot.allowedCapabilityIds],
  };
}

/** Maps a workflow_step_executions row to a {@link WorkflowStepExecution} snapshot. */
function rowToExecutionSnapshot(
  row: WorkflowStepExecutionRow,
): ReturnType<typeof WorkflowStepExecution.snapshot> {
  return {
    id: row.id,
    workflowId: row.workflowId,
    tenantId: row.tenantId,
    stepId: row.stepId,
    name: row.name,
    capabilityId: row.capabilityId,
    toolId: row.toolId,
    status: row.status as ReturnType<typeof WorkflowStepExecution.snapshot>['status'],
    attempt: row.attempt,
    executionKey: row.executionKey,
    input: row.input as Record<string, unknown>,
    output: row.output === null ? undefined : row.output,
    error: row.error ?? undefined,
    approvalId: row.approvalId ?? undefined,
    startedAt: toIso(row.startedAt),
    finishedAt: row.finishedAt === null ? undefined : toIso(row.finishedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Maps a {@link WorkflowStepExecution} snapshot to a journal row. */
function executionSnapshotToRow(
  snapshot: ReturnType<typeof WorkflowStepExecution.snapshot>,
): WorkflowStepExecutionRow {
  return {
    id: snapshot.id,
    workflowId: snapshot.workflowId,
    tenantId: snapshot.tenantId,
    stepId: snapshot.stepId,
    name: snapshot.name,
    capabilityId: snapshot.capabilityId,
    toolId: snapshot.toolId,
    status: snapshot.status,
    attempt: snapshot.attempt,
    executionKey: snapshot.executionKey,
    input: snapshot.input,
    output: snapshot.output === undefined ? null : snapshot.output,
    error: snapshot.error ?? null,
    approvalId: snapshot.approvalId ?? null,
    startedAt: toDate(snapshot.startedAt),
    finishedAt: snapshot.finishedAt === undefined ? null : toDate(snapshot.finishedAt),
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link WorkflowInstanceRepository} implementation. */
export class PgWorkflowInstanceRepository implements WorkflowInstanceRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: string): Promise<WorkflowInstance | undefined> {
    const row = await this.#db.query.workflowInstances.findFirst({
      where: eq(workflowInstances.id, id),
    });
    return row === undefined ? undefined : WorkflowInstance.hydrate(rowToWorkflowSnapshot(row));
  }

  async listByTenant(tenantId: TenantId, limit?: number): Promise<readonly WorkflowInstance[]> {
    const rows = await this.#db.query.workflowInstances.findMany({
      where: eq(workflowInstances.tenantId, tenantId),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      limit: limit ?? 100,
    });
    return rows.map((row) => WorkflowInstance.hydrate(rowToWorkflowSnapshot(row)));
  }

  async save(instance: WorkflowInstance): Promise<void> {
    const row = workflowSnapshotToRow(WorkflowInstance.snapshot(instance));
    await this.#db
      .insert(workflowInstances)
      .values(row)
      .onConflictDoUpdate({ target: workflowInstances.id, set: row });
  }
}

/** Drizzle {@link WorkflowStepExecutionRepository} implementation. */
export class PgWorkflowStepExecutionRepository implements WorkflowStepExecutionRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: string): Promise<WorkflowStepExecution | undefined> {
    const row = await this.#db.query.workflowStepExecutions.findFirst({
      where: eq(workflowStepExecutions.id, id),
    });
    return row === undefined
      ? undefined
      : WorkflowStepExecution.hydrate(rowToExecutionSnapshot(row));
  }

  async findByWorkflowAndStep(
    workflowId: string,
    stepId: string,
  ): Promise<WorkflowStepExecution | undefined> {
    const row = await this.#db.query.workflowStepExecutions.findFirst({
      where: and(
        eq(workflowStepExecutions.workflowId, workflowId),
        eq(workflowStepExecutions.stepId, stepId),
      ),
      orderBy: (table, { desc }) => [desc(table.attempt)],
    });
    return row === undefined
      ? undefined
      : WorkflowStepExecution.hydrate(rowToExecutionSnapshot(row));
  }

  async listByWorkflow(workflowId: string): Promise<readonly WorkflowStepExecution[]> {
    const rows = await this.#db.query.workflowStepExecutions.findMany({
      where: eq(workflowStepExecutions.workflowId, workflowId),
      orderBy: (table, { asc }) => [asc(table.createdAt)],
    });
    return rows.map((row) => WorkflowStepExecution.hydrate(rowToExecutionSnapshot(row)));
  }

  async listByTenant(
    tenantId: TenantId,
    limit?: number,
  ): Promise<readonly WorkflowStepExecution[]> {
    // Newest-first + bounded, consistent with the other audit journal
    // queries (workflow instances, agent executions, approvals). Without
    // this the Audit Center performed an unbounded tenant-wide scan of the
    // entire step journal on every page load.
    const rows = await this.#db.query.workflowStepExecutions.findMany({
      where: eq(workflowStepExecutions.tenantId, tenantId),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      limit: limit ?? 500,
    });
    return rows.map((row) => WorkflowStepExecution.hydrate(rowToExecutionSnapshot(row)));
  }

  async save(execution: WorkflowStepExecution): Promise<void> {
    const row = executionSnapshotToRow(WorkflowStepExecution.snapshot(execution));
    await this.#db
      .insert(workflowStepExecutions)
      .values(row)
      .onConflictDoUpdate({ target: workflowStepExecutions.id, set: row });
  }
}
