/**
 * Test fakes for the workflow module: in-memory repositories, a recording
 * event publisher, a scripted step executor, and an in-memory approval port —
 * so the engine is tested in isolation (no PostgreSQL, no AI runtime).
 */

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import type { TenantId } from '@nexora/contracts/common';

import type { WorkflowInstance } from '../src/domain/workflow-instance.js';
import type { WorkflowStepExecution } from '../src/domain/workflow-step-execution.js';
import type {
  WorkflowInstanceRepository,
  WorkflowStepExecutionRepository,
} from '../src/repositories/workflow-repository.js';
import type {
  OpenWorkflowApprovalInput,
  WorkflowApprovalPort,
  WorkflowApprovalRecord,
} from '../src/runtime/workflow-approval.js';
import type {
  WorkflowStepExecutor,
  WorkflowStepInvocation,
  WorkflowStepResult,
} from '../src/runtime/workflow-executor.js';

/** An in-memory {@link WorkflowInstanceRepository}. */
export class InMemoryWorkflowInstanceRepository implements WorkflowInstanceRepository {
  readonly instances = new Map<string, WorkflowInstance>();

  async findById(id: string): Promise<WorkflowInstance | undefined> {
    return this.instances.get(id);
  }

  async listByTenant(tenantId: TenantId, limit?: number): Promise<readonly WorkflowInstance[]> {
    return [...this.instances.values()]
      .filter((instance) => instance.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit ?? 100);
  }

  async save(instance: WorkflowInstance): Promise<void> {
    this.instances.set(instance.id, instance);
  }
}

/** An in-memory {@link WorkflowStepExecutionRepository}. */
export class InMemoryWorkflowStepExecutionRepository implements WorkflowStepExecutionRepository {
  readonly executions = new Map<string, WorkflowStepExecution>();

  async findById(id: string): Promise<WorkflowStepExecution | undefined> {
    return this.executions.get(id);
  }

  async findByWorkflowAndStep(
    workflowId: string,
    stepId: string,
  ): Promise<WorkflowStepExecution | undefined> {
    return [...this.executions.values()]
      .filter((execution) => execution.workflowId === workflowId && execution.stepId === stepId)
      .sort((a, b) => b.attempt - a.attempt)[0];
  }

  async listByWorkflow(workflowId: string): Promise<readonly WorkflowStepExecution[]> {
    return [...this.executions.values()]
      .filter((execution) => execution.workflowId === workflowId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listByTenant(
    tenantId: TenantId,
    limit?: number,
  ): Promise<readonly WorkflowStepExecution[]> {
    return [...this.executions.values()]
      .filter((execution) => execution.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit ?? 500);
  }

  async save(execution: WorkflowStepExecution): Promise<void> {
    this.executions.set(execution.id, execution);
  }
}

/** A recording {@link EventPublisher} (asserts on the emitted stream). */
export class RecordingEventPublisher implements EventPublisher {
  readonly published: EventEnvelope[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    this.published.push(...events);
  }

  /** The event types published, in order. */
  types(): readonly string[] {
    return this.published.map((event) => event.type);
  }

  /** The published events of a type. */
  ofType(type: string): readonly EventEnvelope[] {
    return this.published.filter((event) => event.type === type);
  }
}

/**
 * A scripted {@link WorkflowStepExecutor}: per-tool results (including
 * failures, retries, and blocks) plus a call log for assertions.
 */
export class ScriptedWorkflowStepExecutor implements WorkflowStepExecutor {
  readonly calls: { toolId: string; stepId: string; input: Record<string, unknown> }[] = [];
  #results = new Map<string, WorkflowStepResult[]>();
  readonly #defaultResult: WorkflowStepResult;

  constructor(defaultResult: WorkflowStepResult) {
    this.#defaultResult = defaultResult;
  }

  /** Queues results for a tool id (consumed in order). */
  forTool(toolId: string, ...results: WorkflowStepResult[]): this {
    this.#results.set(toolId, [...(this.#results.get(toolId) ?? []), ...results]);
    return this;
  }

  async execute(invocation: WorkflowStepInvocation): Promise<WorkflowStepResult> {
    this.calls.push({
      toolId: invocation.toolId,
      stepId: invocation.stepId,
      input: invocation.input,
    });
    const queued = this.#results.get(invocation.toolId);
    if (queued !== undefined && queued.length > 0) {
      return queued.shift() as WorkflowStepResult;
    }
    return this.#defaultResult;
  }
}

/** Builds a default successful step result. */
export function okResult(output: unknown): WorkflowStepResult {
  return {
    ok: true,
    output,
    blocked: false,
    verified: true,
    sideEffectClass: 'read_only',
    attempts: 1,
    retryable: true,
  };
}

/** Builds a failing step result. */
export function failResult(message: string): WorkflowStepResult {
  return {
    ok: false,
    error: { code: 'EXECUTION_ERROR', message },
    blocked: false,
    verified: false,
    sideEffectClass: 'consequential',
    attempts: 1,
    retryable: true,
  };
}

/** An in-memory {@link WorkflowApprovalPort} (mirrors the platform engine). */
export class FakeWorkflowApprovalPort implements WorkflowApprovalPort {
  readonly requests = new Map<string, WorkflowApprovalRecord>();

  open(input: OpenWorkflowApprovalInput): WorkflowApprovalRecord {
    const record: WorkflowApprovalRecord = {
      id: `apr_test_${this.requests.size + 1}`,
      ...input,
      status: 'awaiting_approval',
    };
    this.requests.set(record.id, record);
    return record;
  }

  decisionStatus(id: string): 'pending' | 'granted' | 'rejected' | 'expired' | undefined {
    const request = this.requests.get(id);
    if (request === undefined) {
      return undefined;
    }
    if (request.status === 'rejected') {
      return 'rejected';
    }
    if (request.status === 'expired') {
      return 'expired';
    }
    if (request.status === 'approved' || request.status === 'executing') {
      return 'granted';
    }
    return 'pending';
  }

  byId(id: string): WorkflowApprovalRecord | undefined {
    return this.requests.get(id);
  }

  claim(id: string): boolean {
    const request = this.requests.get(id);
    if (request === undefined || request.status !== 'approved') {
      return false;
    }
    this.requests.set(id, { ...request, status: 'executing' });
    return true;
  }

  recordOutcome(
    id: string,
    outcome: { status: 'completed' | 'failed'; result?: unknown; error?: string },
  ): void {
    const request = this.requests.get(id);
    if (request === undefined) {
      return;
    }
    this.requests.set(id, {
      ...request,
      status: outcome.status,
      result: outcome.result,
      error: outcome.error,
    });
  }

  /** Marks an approval expired (test helper). */
  expire(id: string): void {
    const request = this.requests.get(id);
    if (request !== undefined) {
      this.requests.set(id, { ...request, status: 'expired' });
    }
  }

  /** Records a decision (test helper). */
  decide(id: string, decision: 'grant' | 'reject'): void {
    const request = this.requests.get(id);
    if (request === undefined) {
      return;
    }
    this.requests.set(id, {
      ...request,
      status: decision === 'grant' ? 'approved' : 'rejected',
    });
  }
}

/** A trusted run context for tests. */
export function testContext(overrides: { tenantId?: string } = {}) {
  return {
    userId: 'usr_test',
    tenantId: (overrides.tenantId ?? 'org_test') as TenantId,
    correlationId: 'corr_test',
  };
}
