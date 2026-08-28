/**
 * @nexora/module-workflow — repository ports.
 *
 * The persistence ports the workflow runtime depends on (PERSISTENCE.md §4).
 * Domain/application layers depend on these contracts; the infrastructure
 * layer provides implementations (Drizzle in `@nexora/persistence`,
 * in-memory fakes in tests). Every read is tenant-scoped — a caller can
 * never list, load, or mutate another tenant's workflow state.
 */

import type { TenantId } from '@nexora/contracts/common';

import type { WorkflowInstance, WorkflowInstanceSnapshot } from '../domain/workflow-instance.js';
import type {
  WorkflowStepExecution,
  WorkflowStepExecutionSnapshot,
} from '../domain/workflow-step-execution.js';

/** The workflow instance repository port. */
export interface WorkflowInstanceRepository {
  /** Persists an instance (insert or update; id is the identity). */
  save(instance: WorkflowInstance): Promise<void>;
  /** Loads an instance by id, or `undefined`. */
  findById(id: string): Promise<WorkflowInstance | undefined>;
  /** Lists the instances of a tenant, newest first. */
  listByTenant(tenantId: TenantId, limit?: number): Promise<readonly WorkflowInstance[]>;
}

/** The workflow step-execution journal port. */
export interface WorkflowStepExecutionRepository {
  /** Persists an execution record (id is the identity). */
  save(execution: WorkflowStepExecution): Promise<void>;
  /** Loads an execution record by id, or `undefined`. */
  findById(id: string): Promise<WorkflowStepExecution | undefined>;
  /** Loads the execution of a step, or `undefined` (idempotency lookup). */
  findByWorkflowAndStep(
    workflowId: string,
    stepId: string,
  ): Promise<WorkflowStepExecution | undefined>;
  /** Lists the executions of a workflow in creation order. */
  listByWorkflow(workflowId: string): Promise<readonly WorkflowStepExecution[]>;
  /**
   * Lists the executions of a workflow's tenant (journal audit), newest
   * first, bounded by `limit` (default 500). The bound keeps the audit
   * aggregation from performing an unbounded tenant-wide scan as the
   * step journal grows.
   */
  listByTenant(tenantId: TenantId, limit?: number): Promise<readonly WorkflowStepExecution[]>;
}

export type { WorkflowInstanceSnapshot, WorkflowStepExecutionSnapshot };
