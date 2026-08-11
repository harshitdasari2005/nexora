/**
 * @nexora/module-workflow — WorkflowRuntime.
 *
 * The journaled workflow engine (SAD.md §12): creates validated instances,
 * evaluates step readiness from the dependency graph, executes steps ONLY
 * through the {@link WorkflowStepExecutor} port (never touching domains,
 * repositories, or PostgreSQL directly), waits for step approvals through the
 * shared {@link WorkflowApprovalPort}, retries transient failures within a
 * step's retry budget, and journals every attempt with a stable execution
 * identity (idempotent replay).
 *
 * Strict separation (BKD.md §8): the engine decides WHICH step is ready; the
 * executor performs the capability invocation; the owning application layer
 * performs the business mutation. The engine contains NO Projects/HR logic.
 *
 * Consistency model: no distributed transactions. The instance is the
 * journal — the workflow-level authorization (a single granted approval for
 * the whole workflow unit) covers internal step mutations; each step's
 * mutation goes through the owning bounded context. Compensation is recorded
 * but not destructive in v1 (see module README).
 */

import { err, ok, type Result } from '@nexora/shared/result';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { WorkflowDefinitionRegistry } from '../domain/workflow-definition.js';
import {
  DuplicateStepExecutionError,
  WorkflowApprovalError,
  WorkflowDefinitionNotFoundError,
  WorkflowError,
  WorkflowInstanceNotFoundError,
  WorkflowNotRunningError,
} from '../domain/errors.js';
import { resolveStepInput } from '../domain/input-resolver.js';
import { WorkflowInstance } from '../domain/workflow-instance.js';
import { WorkflowStepExecution } from '../domain/workflow-step-execution.js';
import type {
  WorkflowInstanceRepository,
  WorkflowStepExecutionRepository,
} from '../repositories/workflow-repository.js';
import type { WorkflowEventContext } from '../events/index.js';
import {
  workflowStepCompletedEvent,
  workflowStepFailedEvent,
  workflowStepStartedEvent,
} from '../events/index.js';
import type {
  WorkflowExecutionRecord,
  WorkflowInstance as WorkflowInstanceContract,
} from '@nexora/contracts/workflow';
import type { WorkflowApprovalPort } from './workflow-approval.js';
import type { WorkflowStepExecutor, WorkflowStepResult } from './workflow-executor.js';

/** The trusted execution context of a workflow run. */
export interface WorkflowRunContext {
  /** The initiating user (trusted). */
  userId: string;
  /** Tenant (organization) scope (trusted). */
  tenantId: TenantId;
  /** Workspace scope, when workspace-scoped (trusted). */
  workspaceId?: WorkspaceId;
  /** Correlation id of the originating execution (trusted). */
  correlationId: string;
}

/** Input for starting a workflow instance. */
export interface StartWorkflowInput {
  /** The definition key to execute. */
  definitionKey: string;
  /** The trusted run context. */
  context: WorkflowRunContext;
  /** The workflow input (user-controlled business values). */
  input: Record<string, unknown>;
}

/** Dependencies of the {@link WorkflowRuntime}. */
export interface WorkflowRuntimeDependencies {
  /** The definition registry (the only source of templates). */
  definitions: WorkflowDefinitionRegistry;
  /** Workflow instance persistence. */
  instances: WorkflowInstanceRepository;
  /** Step-execution journal persistence. */
  executions: WorkflowStepExecutionRepository;
  /** The capability executor (wired to the platform tool executor). */
  executor: WorkflowStepExecutor;
  /** The shared approval engine (optional; gates approval points). */
  approvals?: WorkflowApprovalPort;
  /** Publishes workflow events to the canonical event stream. */
  publisher: EventPublisher;
  /** Clock (tests inject a fixed time). */
  now?: () => string;
}

/**
 * The journaled workflow engine.
 */
export class WorkflowRuntime {
  readonly #definitions: WorkflowDefinitionRegistry;
  readonly #instances: WorkflowInstanceRepository;
  readonly #executions: WorkflowStepExecutionRepository;
  readonly #executor: WorkflowStepExecutor;
  readonly #approvals?: WorkflowApprovalPort;
  readonly #publisher: EventPublisher;
  readonly #now: () => string;

  constructor(dependencies: WorkflowRuntimeDependencies) {
    this.#definitions = dependencies.definitions;
    this.#instances = dependencies.instances;
    this.#executions = dependencies.executions;
    this.#executor = dependencies.executor;
    this.#approvals = dependencies.approvals;
    this.#publisher = dependencies.publisher;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  /**
   * Creates a workflow instance from a validated definition and runs it to a
   * terminal state: create → planning → ready → running → drain → terminal.
   * No instance exists before the definition and input validate (validate →
   * mutate → event).
   */
  async create(input: StartWorkflowInput): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    try {
      const definition = this.#definitions.getByKey(input.definitionKey);
      if (definition === undefined) {
        return err(new WorkflowDefinitionNotFoundError({ key: input.definitionKey }));
      }
      const missing = missingInputKeys(definition, input.input);
      if (missing.length > 0) {
        return err(new WorkflowApprovalError(`Workflow input is missing: ${missing.join(', ')}`));
      }

      const context = this.#eventContext(input.context);
      const instance = WorkflowInstance.create(
        {
          definitionId: definition.id,
          definitionKey: definition.key,
          definitionVersion: definition.version,
          tenantId: input.context.tenantId,
          userId: input.context.userId,
          workspaceId: input.context.workspaceId,
          correlationId: input.context.correlationId,
          input: input.input,
        },
        context,
        this.#now(),
      );
      instance.plan(this.#now());
      instance.ready(this.#now());
      await this.#instances.save(instance);
      await this.#publish(instance.pullDomainEvents());

      instance.start(context, this.#now());
      await this.#instances.save(instance);
      await this.#publish(instance.pullDomainEvents());

      await this.#drain(instance);
      return ok(await this.#record(instance.id));
    } catch (error) {
      return err(toWorkflowError(error));
    }
  }

  /**
   * Resumes a workflow that paused for a step approval. The decision is
   * trusted server-side state (recorded through the shared approval engine):
   * granted → the waiting step executes exactly once; rejected → the
   * workflow fails with NO further mutation.
   */
  async resume(input: {
    workflowId: string;
    approvalId: string;
  }): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    try {
      const instance = await this.#requireInstance(input.workflowId);
      if (instance.status !== 'awaiting_approval') {
        return err(
          new WorkflowNotRunningError({ workflowId: instance.id, status: instance.status }),
        );
      }
      const approval = this.#approvals?.byId(input.approvalId);
      if (approval === undefined) {
        return err(new WorkflowApprovalError('Approval request not found'));
      }
      // Ownership: the approval must belong to this workflow's trusted scope
      // (user + tenant). A foreign approval never resumes a workflow.
      if (approval.userId !== instance.userId || approval.tenantId !== instance.tenantId) {
        return err(new WorkflowApprovalError('Approval does not belong to this workflow'));
      }
      const disposition = this.#approvals?.decisionStatus(input.approvalId);
      if (disposition === 'rejected') {
        const context = this.#eventContext(this.#contextOf(instance));
        instance.fail('A required approval was rejected', context, this.#now());
        await this.#instances.save(instance);
        await this.#publish(instance.pullDomainEvents());
        return ok(await this.#record(instance.id));
      }
      if (disposition !== 'granted') {
        return err(new WorkflowApprovalError('Approval has not been granted yet'));
      }
      // Single-flight: atomically claim the granted decision before any step
      // executes — a second resume of the same approval can never re-run the
      // workflow (exactly-once, safe replay).
      if (this.#approvals?.claim(input.approvalId) !== true) {
        return err(new WorkflowApprovalError('Approval is already being executed'));
      }

      instance.resume(this.#now());
      await this.#instances.save(instance);
      await this.#drain(instance, { resumedApprovalId: input.approvalId });
      // Complete the claimed approval's lifecycle with the journaled
      // outcome (`executing` → `completed`/`failed`) when the workflow
      // reached a terminal state: the decision is terminal, and a replay of
      // the same approval can never re-run the workflow (claim already
      // guards the single-flight transition). If the workflow pauses for
      // ANOTHER approval, the claimed decision stays `executing` (it did
      // run) — no misleading terminal state is recorded.
      const finalStatus: string = instance.status;
      if (['succeeded', 'failed', 'cancelled', 'compensated'].includes(finalStatus)) {
        this.#approvals?.recordOutcome(input.approvalId, {
          status: finalStatus === 'succeeded' ? 'completed' : 'failed',
          result: instance.output,
          error: instance.error,
        });
      }
      return ok(await this.#record(instance.id));
    } catch (error) {
      return err(toWorkflowError(error));
    }
  }

  /** Cancels a running/waiting workflow (no further steps execute). */
  async cancel(input: {
    workflowId: string;
    actorId: string;
    tenantId: TenantId;
  }): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    try {
      const instance = await this.#requireInstance(input.workflowId);
      if (instance.tenantId !== input.tenantId) {
        return err(new WorkflowInstanceNotFoundError({ workflowId: input.workflowId }));
      }
      if (instance.isTerminal()) {
        return err(
          new WorkflowNotRunningError({ workflowId: instance.id, status: instance.status }),
        );
      }
      const context = this.#eventContext(this.#contextOf(instance));
      instance.cancel(context, this.#now());
      await this.#instances.save(instance);
      await this.#publish(instance.pullDomainEvents());
      return ok(await this.#record(instance.id));
    } catch (error) {
      return err(toWorkflowError(error));
    }
  }

  /**
   * Reads a workflow execution record. Tenant-scoped: a foreign workflow id
   * resolves to NOT FOUND — never to another tenant's journal.
   */
  async get(input: {
    workflowId: string;
    tenantId: TenantId;
  }): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    try {
      const instance = await this.#requireInstance(input.workflowId);
      if (instance.tenantId !== input.tenantId) {
        return err(new WorkflowInstanceNotFoundError({ workflowId: input.workflowId }));
      }
      return ok(await this.#record(instance.id));
    } catch (error) {
      return err(toWorkflowError(error));
    }
  }

  /** Lists the workflow instances of a tenant (newest first). */
  async list(input: {
    tenantId: TenantId;
  }): Promise<Result<readonly WorkflowInstanceContract[], WorkflowError>> {
    try {
      const instances = await this.#instances.listByTenant(input.tenantId);
      return ok(instances.map((instance) => instance.toContract()));
    } catch (error) {
      return err(toWorkflowError(error));
    }
  }

  /**
   * The drain loop: evaluates ready steps (dependencies satisfied), executes
   * them, and transitions the instance to a terminal state. Runs until the
   * instance is no longer running or a step waits for approval / fails.
   */
  async #drain(
    instance: WorkflowInstance,
    options: { resumedApprovalId?: string } = {},
  ): Promise<void> {
    const definition = this.#definitions.getById(instance.definitionId);
    if (definition === undefined) {
      return;
    }
    const context = this.#eventContext(this.#contextOf(instance));

    while (instance.isRunning()) {
      const journal = await this.#executions.listByWorkflow(instance.id);
      const succeeded = new Set(
        journal.filter((execution) => execution.status === 'succeeded').map((e) => e.stepId),
      );
      const failedExecution = journal.find((execution) => execution.status === 'failed');
      const waitingExecution = journal.find(
        (execution) => execution.status === 'pending' && execution.approvalId !== undefined,
      );

      const ready = definition.steps.filter(
        (step) =>
          !succeeded.has(step.id) &&
          (step.dependsOn ?? []).every((dependency) => succeeded.has(dependency)),
      );

      if (ready.length === 0) {
        if (waitingExecution !== undefined) {
          // No step can run while one waits for approval — pause the instance.
          instance.waitForApproval(waitingExecution.stepId, context, this.#now());
          await this.#instances.save(instance);
          await this.#publish(instance.pullDomainEvents());
        } else if (failedExecution !== undefined) {
          const error = failedExecution.error ?? `Step ${failedExecution.stepId} failed`;
          instance.fail(
            `Workflow failed at step ${failedExecution.stepId}: ${error}`,
            context,
            this.#now(),
          );
          await this.#instances.save(instance);
          await this.#publish(instance.pullDomainEvents());
        } else if (definition.steps.every((step) => succeeded.has(step.id))) {
          // All steps succeeded — the accumulated state is the output.
          instance.complete({ ...instance.state }, context, this.#now());
          await this.#instances.save(instance);
          await this.#publish(instance.pullDomainEvents());
        } else {
          instance.fail('Workflow stalled without progress', context, this.#now());
          await this.#instances.save(instance);
          await this.#publish(instance.pullDomainEvents());
        }
        return;
      }

      for (const step of ready) {
        const outcome = await this.#executeStep(instance, step, context, options.resumedApprovalId);
        if (outcome === 'waiting') {
          // Pause the instance for the step approval: no step executes while
          // it waits, and nothing runs again until an approved resume.
          instance.waitForApproval(step.id, context, this.#now());
          await this.#instances.save(instance);
          await this.#publish(instance.pullDomainEvents());
          return;
        }
        if (outcome === 'failed') {
          return;
        }
      }
    }
  }

  /**
   * Executes one step: journal → (approval point? wait) → run attempts →
   * succeed/fail. Returns the outcome for the drain loop.
   */
  async #executeStep(
    instance: WorkflowInstance,
    step: {
      id: string;
      name: string;
      capabilityId?: string;
      toolId?: string;
      input?: Record<string, unknown>;
      retryPolicy?: { maxAttempts: number; backoffMs: number };
    },
    context: WorkflowEventContext,
    resumedApprovalId: string | undefined,
  ): Promise<'done' | 'waiting' | 'failed'> {
    const existing = await this.#executions.findByWorkflowAndStep(instance.id, step.id);
    // Idempotent replay: an already-succeeded attempt never re-runs.
    if (existing !== undefined && existing.status === 'succeeded') {
      return 'done';
    }

    const definition = this.#definitions.getById(instance.definitionId);
    const approvalPoint = definition?.approvalPoints[step.id];
    const boundInput = resolveStepInput(step.input, instance.input, instance.state);
    const capabilityId = step.capabilityId ?? '';
    const toolId = step.toolId ?? '';

    // Approval point: unless THIS step is resuming under its granted
    // decision, the step opens a recorded approval request and the instance
    // pauses. A resumed approval only releases its own step — other gated
    // steps keep waiting.
    if (approvalPoint !== undefined && this.#approvals !== undefined) {
      if (existing?.approvalId !== undefined && existing.approvalId === resumedApprovalId) {
        // The granted decision covers THIS step — fall through to execute.
      } else if (existing?.approvalId !== undefined) {
        return 'waiting';
      } else {
        const approval = this.#approvals.open({
          userId: instance.userId,
          tenantId: instance.tenantId,
          workspaceId: instance.workspaceId,
          runId: instance.correlationId,
          stepId: step.id,
          toolId,
          capabilityId,
          sideEffectClass: 'consequential',
          reason: `Workflow step "${step.name}" requires approval`,
          input: boundInput,
        });
        const execution =
          existing ??
          WorkflowStepExecution.create(
            {
              workflowId: instance.id,
              tenantId: instance.tenantId,
              stepId: step.id,
              name: step.name,
              capabilityId,
              toolId,
              input: boundInput,
            },
            this.#now(),
          );
        execution.waitingForApproval(approval.id, this.#now());
        await this.#executions.save(execution);
        return 'waiting';
      }
    }

    const maxAttempts = step.retryPolicy?.maxAttempts ?? 1;
    const execution =
      existing ??
      WorkflowStepExecution.create(
        {
          workflowId: instance.id,
          tenantId: instance.tenantId,
          stepId: step.id,
          name: step.name,
          capabilityId,
          toolId,
          input: boundInput,
        },
        this.#now(),
      );

    for (let attempt = execution.attempt + 1; attempt <= maxAttempts; attempt += 1) {
      try {
        execution.markRunning(attempt, this.#now());
        await this.#executions.save(execution);
        await this.#publish([
          workflowStepStartedEvent(context, {
            workflowId: instance.id,
            tenantId: instance.tenantId,
            stepId: step.id,
            stepName: step.name,
            capabilityId,
            toolId,
            attempt,
          }),
        ]);

        const result = await this.#executor.execute({
          stepId: step.id,
          capabilityId,
          toolId,
          // The SAME bound input recorded on the approval/execution record is
          // executed — the approval `input` always matches what ran.
          input: boundInput,
          context: {
            userId: instance.userId,
            tenantId: instance.tenantId,
            workspaceId: instance.workspaceId,
            runId: instance.correlationId,
            autonomyTier: 'supervised',
          },
          // Steps execute under the workflow-level authorization (the whole
          // workflow is a gated unit). Step-level approval points add an
          // extra human-control gate handled above/by resume.
          approvalGranted: true,
        });

        if (result.ok && !result.blocked) {
          execution.succeed(result.output, this.#now());
          instance.mergeState(step.id, result.output, this.#now());
          await this.#executions.save(execution);
          await this.#instances.save(instance);
          await this.#publish([
            workflowStepCompletedEvent(context, {
              workflowId: instance.id,
              tenantId: instance.tenantId,
              stepId: step.id,
              stepName: step.name,
              capabilityId,
              toolId,
              attempt,
              output: result.output,
            }),
          ]);
          return 'done';
        }

        const error = result.blocked
          ? `Step ${step.id} is waiting for approval`
          : (result.error?.message ?? `Step ${step.id} failed`);
        const retryable =
          result.retryable === true && result.blocked === false && attempt < maxAttempts;
        if (retryable) {
          execution.markPendingForRetry(this.#now());
          await this.#executions.save(execution);
          await sleep(step.retryPolicy?.backoffMs ?? 0);
          continue;
        }

        execution.fail(error, this.#now());
        await this.#executions.save(execution);
        await this.#publish([
          workflowStepFailedEvent(context, {
            workflowId: instance.id,
            tenantId: instance.tenantId,
            stepId: step.id,
            stepName: step.name,
            capabilityId,
            toolId,
            attempt,
            error,
          }),
        ]);
        instance.fail(`Step ${step.id} (${step.name}) failed: ${error}`, context, this.#now());
        await this.#instances.save(instance);
        await this.#publish(instance.pullDomainEvents());
        return 'failed';
      } catch (caught) {
        const error = toWorkflowError(caught);
        execution.fail(error.message, this.#now());
        await this.#executions.save(execution);
        await this.#publish([
          workflowStepFailedEvent(context, {
            workflowId: instance.id,
            tenantId: instance.tenantId,
            stepId: step.id,
            stepName: step.name,
            capabilityId,
            toolId,
            attempt,
            error: error.message,
          }),
        ]);
        instance.fail(
          `Step ${step.id} (${step.name}) failed: ${error.message}`,
          context,
          this.#now(),
        );
        await this.#instances.save(instance);
        await this.#publish(instance.pullDomainEvents());
        return 'failed';
      }
    }
    return 'failed';
  }

  /** Loads an instance or throws {@link WorkflowInstanceNotFoundError}. */
  async #requireInstance(workflowId: string): Promise<WorkflowInstance> {
    const instance = await this.#instances.findById(workflowId);
    if (instance === undefined) {
      throw new WorkflowInstanceNotFoundError({ workflowId });
    }
    return instance;
  }

  /** Assembles the execution record (instance + journal). */
  async #record(workflowId: string): Promise<WorkflowExecutionRecord> {
    const instance = await this.#requireInstance(workflowId);
    const executions = await this.#executions.listByWorkflow(workflowId);
    const definition = this.#definitions.getById(instance.definitionId);
    const order = new Map(
      (definition?.steps ?? []).map((step, index) => [step.id, index] as const),
    );
    const steps = [...executions].sort(
      (a, b) => (order.get(a.stepId) ?? 0) - (order.get(b.stepId) ?? 0),
    );
    return {
      instance: instance.toContract(),
      steps: steps.map((execution) => execution.toContract()),
    };
  }

  /** The trusted event context of a workflow. */
  #eventContext(context: WorkflowRunContext): WorkflowEventContext {
    return {
      actor: { kind: 'user', id: context.userId },
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
    };
  }

  /** The run context of an instance (from its trusted immutable fields). */
  #contextOf(instance: WorkflowInstance): WorkflowRunContext {
    return {
      userId: instance.userId,
      tenantId: instance.tenantId,
      workspaceId: instance.workspaceId,
      correlationId: instance.correlationId,
    };
  }

  /** Publishes a batch of workflow events (at-least-once). */
  async #publish(events: readonly EventEnvelope[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    await this.#publisher.publish(events);
  }
}

/** Collects the `{{key}}` placeholders a definition's steps require. */
function missingInputKeys(
  definition: { steps: readonly { input?: Record<string, unknown> }[] },
  input: Record<string, unknown>,
): readonly string[] {
  const keys = new Set<string>();
  for (const step of definition.steps) {
    for (const value of Object.values(step.input ?? {})) {
      if (typeof value === 'string') {
        const match = value.match(/^\{\{([A-Za-z0-9_]+)\}\}$/);
        if (match !== null) {
          keys.add(match[1] as string);
        }
      }
    }
  }
  return [...keys].filter((key) => !(key in input));
}

/** Maps any thrown error to a {@link WorkflowError}. */
function toWorkflowError(error: unknown): WorkflowError {
  if (error instanceof WorkflowError) {
    return error;
  }
  if (error instanceof DuplicateStepExecutionError) {
    return error;
  }
  return new WorkflowError('WORKFLOW_EXECUTION_ERROR', messageOf(error));
}

/** A message-safe description of an unknown error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Backoff sleep between retries. */
function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type { WorkflowStepResult };
