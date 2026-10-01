/**
 * @nexora/module-workflow — WorkflowStepExecution journal record.
 *
 * The step journal (SAD.md §12.6): one record per (workflow, step, attempt).
 * The `executionKey` (`workflowId:stepId:attempt`) is the idempotency
 * identity — a duplicate delivery can never create a second business
 * mutation for the same attempt. The record captures the bound input, the
 * output, the failure, the attempt count, and the approval reference so the
 * execution is fully auditable.
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { TenantId } from '@nexora/contracts/common';
import type { WorkflowStepExecution as WorkflowStepExecutionContract } from '@nexora/contracts/workflow';

import type { StepExecutionStatus } from './workflow-status.js';

/** Input for creating a {@link WorkflowStepExecution}. */
export interface CreateStepExecutionInput {
  /** The owning workflow instance id. */
  workflowId: string;
  /** Tenant scope (trusted). */
  tenantId: TenantId;
  /** The executed step id. */
  stepId: string;
  /** Human-readable step name. */
  name: string;
  /** The capability executed. */
  capabilityId: string;
  /** The tool invoked. */
  toolId: string;
  /** The bound step input at execution time. */
  input: Record<string, unknown>;
}

/** A persistence snapshot of the {@link WorkflowStepExecution} record. */
export interface WorkflowStepExecutionSnapshot {
  id: string;
  workflowId: string;
  tenantId: string;
  stepId: string;
  name: string;
  capabilityId: string;
  toolId: string;
  status: StepExecutionStatus;
  attempt: number;
  executionKey: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  approvalId?: string;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * The {@link WorkflowStepExecution} journal record.
 */
export class WorkflowStepExecution {
  #id: string;
  readonly #workflowId: string;
  readonly #tenantId: TenantId;
  readonly #stepId: string;
  readonly #name: string;
  readonly #capabilityId: string;
  readonly #toolId: string;
  #status: StepExecutionStatus;
  #attempt: number;
  #input: Record<string, unknown>;
  #output?: unknown;
  #error?: string;
  #approvalId?: string;
  readonly #startedAt: string;
  #finishedAt?: string;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;

  private constructor(input: CreateStepExecutionInput, createdAt: string) {
    this.#id = prefixedId('wfx');
    this.#workflowId = input.workflowId;
    this.#tenantId = input.tenantId;
    this.#stepId = input.stepId;
    this.#name = input.name;
    this.#capabilityId = input.capabilityId;
    this.#toolId = input.toolId;
    this.#status = 'pending';
    this.#attempt = 0;
    this.#input = { ...input.input };
    this.#startedAt = createdAt;
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a pending step execution (attempt 0). The record becomes
   * `running` when the engine starts the attempt.
   */
  static create(input: CreateStepExecutionInput, now = nowIso()): WorkflowStepExecution {
    return new WorkflowStepExecution(input, now);
  }

  /** Execution id (`wfx_...`). */
  get id(): string {
    return this.#id;
  }

  /** The owning workflow instance id. */
  get workflowId(): string {
    return this.#workflowId;
  }

  /** Tenant scope. */
  get tenantId(): TenantId {
    return this.#tenantId;
  }

  /** The executed step id. */
  get stepId(): string {
    return this.#stepId;
  }

  /** The step name. */
  get name(): string {
    return this.#name;
  }

  /** The capability executed. */
  get capabilityId(): string {
    return this.#capabilityId;
  }

  /** The tool invoked. */
  get toolId(): string {
    return this.#toolId;
  }

  /** The execution status. */
  get status(): StepExecutionStatus {
    return this.#status;
  }

  /** The 1-based attempt number (0 = not yet started). */
  get attempt(): number {
    return this.#attempt;
  }

  /** The idempotency key: `${workflowId}:${stepId}:${attempt}`. */
  get executionKey(): string {
    return `${this.#workflowId}:${this.#stepId}:${this.#attempt}`;
  }

  /** The bound step input. */
  get input(): Record<string, unknown> {
    return { ...this.#input };
  }

  /** The output on success. */
  get output(): unknown {
    return this.#output;
  }

  /** The failure message, when failed. */
  get error(): string | undefined {
    return this.#error;
  }

  /** The approval request id, when the step waits for approval. */
  get approvalId(): string | undefined {
    return this.#approvalId;
  }

  /** ISO-8601 UTC time the record was created. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time the attempt started. */
  get startedAt(): string {
    return this.#startedAt;
  }

  /** ISO-8601 UTC time the attempt finished, when finished. */
  get finishedAt(): string | undefined {
    return this.#finishedAt;
  }

  /** ISO-8601 UTC time of the last mutation. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version. */
  get version(): number {
    return this.#version;
  }

  /** Marks the record as waiting for a step approval (no execution yet). */
  waitingForApproval(approvalId: string, now = nowIso()): void {
    if (this.#status !== 'pending' || this.#attempt !== 0) {
      throw new Error(`Step execution ${this.#id} cannot wait for approval (${this.#status})`);
    }
    this.#approvalId = approvalId;
    this.#bump(now);
  }

  /** Marks the record as running for the given attempt (1-based). */
  markRunning(attempt: number, now = nowIso()): void {
    if (this.#status === 'succeeded' || this.#status === 'failed') {
      throw new Error(`Step execution ${this.#id} is already ${this.#status}`);
    }
    if (attempt < 1) {
      throw new Error(`Step execution ${this.#id} attempt must be >= 1`);
    }
    this.#attempt = attempt;
    this.#status = 'running';
    this.#bump(now);
  }

  /** Marks the record as pending again for a retry (attempt already bumped). */
  markPendingForRetry(now = nowIso()): void {
    this.#status = 'pending';
    this.#bump(now);
  }

  /** Records a successful execution. */
  /**
   * Re-opens a FAILED execution for another attempt (`failed → pending`),
   * clearing the failure. Only failed executions re-open — a succeeded one
   * never re-runs (idempotent replay). Used to retry a failed compensation;
   * the attempt counter keeps increasing, so each attempt has its own
   * idempotency key.
   */
  reopenForRetry(now = nowIso()): void {
    if (this.#status !== 'failed') {
      throw new Error(`Step execution ${this.#id} is ${this.#status}; only a failed one re-opens`);
    }
    this.#status = 'pending';
    this.#error = undefined;
    this.#finishedAt = undefined;
    this.#bump(now);
  }

  succeed(output: unknown, now = nowIso()): void {
    this.#status = 'succeeded';
    this.#output = output;
    this.#finishedAt = now;
    this.#bump(now);
  }

  /** Records a failed execution. */
  fail(error: string, now = nowIso()): void {
    this.#status = 'failed';
    this.#error = error;
    this.#finishedAt = now;
    this.#bump(now);
  }

  /** Produces a persistence snapshot. */
  static snapshot(execution: WorkflowStepExecution): WorkflowStepExecutionSnapshot {
    return {
      id: execution.id,
      workflowId: execution.workflowId,
      tenantId: execution.tenantId,
      stepId: execution.stepId,
      name: execution.name,
      capabilityId: execution.capabilityId,
      toolId: execution.toolId,
      status: execution.status,
      attempt: execution.attempt,
      executionKey: execution.executionKey,
      input: execution.input,
      output: execution.output,
      error: execution.error,
      approvalId: execution.approvalId,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
      version: execution.version,
    };
  }

  /** Reconstructs a record from a snapshot without emitting events. */
  static hydrate(snapshot: WorkflowStepExecutionSnapshot): WorkflowStepExecution {
    const execution = new WorkflowStepExecution(
      {
        workflowId: snapshot.workflowId,
        tenantId: snapshot.tenantId as TenantId,
        stepId: snapshot.stepId,
        name: snapshot.name,
        capabilityId: snapshot.capabilityId,
        toolId: snapshot.toolId,
        input: snapshot.input,
      },
      snapshot.createdAt,
    );
    execution.#id = snapshot.id;
    execution.#status = snapshot.status;
    execution.#attempt = snapshot.attempt;
    execution.#output = snapshot.output;
    execution.#error = snapshot.error;
    execution.#approvalId = snapshot.approvalId;
    execution.#finishedAt = snapshot.finishedAt;
    execution.#updatedAt = snapshot.updatedAt;
    execution.#version = snapshot.version;
    return execution;
  }

  /** Converts to the canonical contract shape. */
  toContract(): WorkflowStepExecutionContract {
    return {
      id: this.id,
      workflowId: this.workflowId,
      tenantId: this.tenantId,
      stepId: this.stepId,
      name: this.name,
      capabilityId: this.capabilityId,
      toolId: this.toolId,
      status: this.status,
      attempt: this.attempt,
      executionKey: this.executionKey,
      input: this.input,
      output: this.output,
      error: this.error,
      approvalId: this.approvalId,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }

  /** Bumps the version and updated-at timestamp. */
  #bump(now: string): void {
    this.#version += 1;
    this.#updatedAt = now;
  }
}
