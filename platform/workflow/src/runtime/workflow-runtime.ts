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
 * mutation goes through the owning bounded context.
 *
 * Failure model (saga): when a step fails, every COMPLETED state-changing
 * step is compensated in reverse order through its declared compensating
 * capability — never guessed. The outcome is an explicit ledger on the
 * instance (`compensated` / `partial` / `failed`): a step with no safe
 * compensation is reported as outstanding, not silently forgotten, and a
 * failed compensation stays retryable through {@link WorkflowRuntime.recover}.
 * Each compensation is journaled as its own step (`compensate:<stepId>`),
 * so it appears in the audit trail like any other execution.
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
  WorkflowRecoveryNotApplicableError,
} from '../domain/errors.js';
import { resolveStepInput } from '../domain/input-resolver.js';
import { COMPENSATION_STEP_PREFIX } from '../domain/workflow-definition.js';
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
  WorkflowCompensationRecord,
  WorkflowDefinition,
  WorkflowExecutionRecord,
  WorkflowInstance as WorkflowInstanceContract,
  WorkflowOutstandingStep,
} from '@nexora/contracts/workflow';
import type { WorkflowApprovalPort } from './workflow-approval.js';
import type {
  WorkflowStepExecutor,
  WorkflowStepInvocation,
  WorkflowStepResult,
} from './workflow-executor.js';

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
  /**
   * Execution attribution (Prompt 4), all trusted server-side values: the
   * entry point (`agent`, `orchestrator`, `rest`, …), the agent principal
   * and delegation the workflow runs under, and the approval that
   * authorized it. Recorded on the instance — never collapsed into userId.
   */
  origin?: string;
  agentId?: string;
  delegationId?: string;
  approvalId?: string;
  /**
   * The initiating run's RBAC capability ceiling (trusted). It is persisted
   * on the instance and applied to EVERY inner step and compensation: an
   * inner capability outside it fails closed (`FORBIDDEN`). `[]` permits
   * nothing.
   */
  allowedCapabilityIds?: readonly string[];
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
  /** Workflow ids whose recovery is in flight (single-flight guard). */
  readonly #recovering = new Set<string>();

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
   * The forward-step capability/tool ids of a registered definition, in step
   * order (deduplicated), or `undefined` for an unknown key. Compensations are
   * not listed: they are bounded through the forward capability they undo.
   */
  requiredCapabilities(
    definitionKey: string,
  ): readonly { capabilityId: string; toolId: string }[] | undefined {
    const definition = this.#definitions.getByKey(definitionKey);
    if (definition === undefined) {
      return undefined;
    }
    const seen = new Set<string>();
    const out: { capabilityId: string; toolId: string }[] = [];
    for (const step of definition.steps) {
      if (step.capabilityId === undefined || seen.has(step.capabilityId)) {
        continue;
      }
      seen.add(step.capabilityId);
      out.push({ capabilityId: step.capabilityId, toolId: step.toolId ?? step.capabilityId });
    }
    return out;
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
      // Only the input keys the definition declares are accepted: an
      // undeclared key (e.g. one named after a step id, or the reserved
      // compensation ledger key) is refused before any instance exists.
      const declared = declaredInputKeys(definition);
      const undeclared = Object.keys(input.input).filter((key) => !declared.has(key));
      if (undeclared.length > 0) {
        return err(
          new WorkflowApprovalError(
            `Workflow input has undeclared fields: ${undeclared.slice(0, 5).join(', ')}`,
          ),
        );
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
          ...(input.context.origin === undefined ? {} : { origin: input.context.origin }),
          ...(input.context.agentId === undefined ? {} : { agentId: input.context.agentId }),
          ...(input.context.delegationId === undefined
            ? {}
            : { delegationId: input.context.delegationId }),
          ...(input.context.approvalId === undefined
            ? {}
            : { approvalId: input.context.approvalId }),
          ...(input.context.allowedCapabilityIds === undefined
            ? {}
            : { allowedCapabilityIds: input.context.allowedCapabilityIds }),
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
      const approval = await this.#approvals?.byId(input.approvalId);
      if (approval === undefined) {
        return err(new WorkflowApprovalError('Approval request not found'));
      }
      // Ownership: the approval must belong to this workflow's trusted scope
      // (user + tenant). A foreign approval never resumes a workflow.
      if (approval.userId !== instance.userId || approval.tenantId !== instance.tenantId) {
        return err(new WorkflowApprovalError('Approval does not belong to this workflow'));
      }
      const disposition = await this.#approvals?.decisionStatus(input.approvalId);
      if (disposition === 'rejected' || disposition === 'expired') {
        // Rejected OR expired: a terminal NOT-granted outcome — nothing runs.
        const context = this.#eventContext(this.#contextOf(instance));
        await this.#failWorkflow(
          instance,
          disposition === 'expired'
            ? 'A required approval expired before it was granted'
            : 'A required approval was rejected',
          context,
        );
        return ok(await this.#record(instance.id));
      }
      if (disposition !== 'granted') {
        return err(new WorkflowApprovalError('Approval has not been granted yet'));
      }
      // Single-flight: atomically claim the granted decision before any step
      // executes — a second resume of the same approval can never re-run the
      // workflow (exactly-once, safe replay).
      if ((await this.#approvals?.claim(input.approvalId)) !== true) {
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
        await this.#approvals?.recordOutcome(input.approvalId, {
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
          await this.#failWorkflow(
            instance,
            `Workflow failed at step ${failedExecution.stepId}: ${error}`,
            context,
          );
        } else if (definition.steps.every((step) => succeeded.has(step.id))) {
          // All steps succeeded — the accumulated state is the output.
          instance.complete({ ...instance.state }, context, this.#now());
          await this.#instances.save(instance);
          await this.#publish(instance.pullDomainEvents());
        } else {
          await this.#failWorkflow(instance, 'Workflow stalled without progress', context);
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
        const approval = await this.#approvals.open({
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
          purpose: 'step',
          context: this.#invocationContext(instance),
          // Steps execute under the workflow-level authorization (the whole
          // workflow is a gated unit). Step-level approval points add an
          // extra human-control gate handled above/by resume. The basis
          // records WHY approval is treated as granted: through the approval
          // engine (workflow/step approval) or only by the direct, RBAC-
          // authorized start of a human operator (which never satisfies an
          // approval that policy requires beyond the baseline side-effect gate).
          approvalGranted: true,
          approvalBasis:
            instance.approvalId !== undefined || existing?.approvalId !== undefined
              ? 'approval_engine'
              : 'direct_human',
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
        await this.#failWorkflow(
          instance,
          `Step ${step.id} (${step.name}) failed: ${error}`,
          context,
        );
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
        await this.#failWorkflow(
          instance,
          `Step ${step.id} (${step.name}) failed: ${error.message}`,
          context,
        );
        return 'failed';
      }
    }
    return 'failed';
  }

  /**
   * Retries the outstanding compensation of a failed workflow. Applicable
   * only to an instance whose rollback FAILED (`compensation.status ===
   * 'failed'`): a `partial` rollback has no automatic compensating action to
   * retry (the ledger says what a human must recover), and anything else has
   * nothing to undo.
   *
   * Idempotent and single-flight: an already-compensated step is never
   * compensated again (its journal record is final), and a concurrent
   * recovery of the same instance is refused rather than raced. Tenant-scoped
   * like every read.
   */
  async recover(input: {
    workflowId: string;
    tenantId: TenantId;
  }): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    let claimed = false;
    try {
      const instance = await this.#requireInstance(input.workflowId);
      if (instance.tenantId !== input.tenantId) {
        return err(new WorkflowInstanceNotFoundError({ workflowId: input.workflowId }));
      }
      if (instance.status !== 'failed' || instance.compensation?.status !== 'failed') {
        return err(
          new WorkflowRecoveryNotApplicableError({
            workflowId: instance.id,
            reason:
              instance.compensation === undefined
                ? 'no rollback was recorded'
                : `rollback status is ${instance.compensation.status} (${instance.status})`,
          }),
        );
      }
      if (this.#recovering.has(instance.id)) {
        return err(new WorkflowApprovalError('Recovery of this workflow is already in progress'));
      }
      this.#recovering.add(instance.id);
      claimed = true;

      const context = this.#eventContext(this.#contextOf(instance));
      const definition = this.#definitions.getById(instance.definitionId);
      if (definition === undefined) {
        return err(new WorkflowDefinitionNotFoundError({ key: instance.definitionKey }));
      }
      const record = await this.#compensate(instance, definition, context);
      instance.recordCompensation(record, this.#now());
      if (record.status === 'compensated') {
        instance.compensate(instance.error ?? 'Workflow failed', context, this.#now());
      }
      await this.#instances.save(instance);
      await this.#publish(instance.pullDomainEvents());
      return ok(await this.#record(instance.id));
    } catch (error) {
      return err(toWorkflowError(error));
    } finally {
      if (claimed) {
        this.#recovering.delete(input.workflowId);
      }
    }
  }

  /**
   * Ends a failing workflow: undoes the completed state-changing steps, then
   * records the honest terminal state — `compensated` when everything was
   * undone, otherwise `failed` with the rollback ledger saying exactly what
   * remains (never an implied rollback). Persists and publishes.
   */
  async #failWorkflow(
    instance: WorkflowInstance,
    message: string,
    context: WorkflowEventContext,
  ): Promise<void> {
    const definition = this.#definitions.getById(instance.definitionId);
    const record =
      definition === undefined ? undefined : await this.#compensate(instance, definition, context);
    if (record !== undefined && record.status !== 'not_required') {
      instance.recordCompensation(record, this.#now());
    }
    if (record?.status === 'compensated') {
      instance.compensate(message, context, this.#now());
    } else {
      instance.fail(message, context, this.#now());
    }
    await this.#instances.save(instance);
    await this.#publish(instance.pullDomainEvents());
  }

  /**
   * Compensates the completed state-changing steps, newest first. Steps are
   * only ever undone through their DECLARED compensation — a step with none,
   * or whose compensation needs its own approval, is reported outstanding.
   * Read-only steps (`mutatesState: false`) leave nothing to undo.
   *
   * Idempotent: a compensation whose journal record already succeeded is
   * counted, never re-run; a failed one is re-attempted with the next attempt
   * number (each attempt has its own idempotency key). The compensating tool
   * is itself idempotent, so even a lost write cannot double-apply.
   */
  async #compensate(
    instance: WorkflowInstance,
    definition: WorkflowDefinition,
    context: WorkflowEventContext,
  ): Promise<WorkflowCompensationRecord> {
    const journal = await this.#executions.listByWorkflow(instance.id);
    const stepIndex = new Map(definition.steps.map((step, index) => [step.id, index] as const));
    const completed = journal
      .filter(
        (execution) =>
          execution.status === 'succeeded' &&
          !execution.stepId.startsWith(COMPENSATION_STEP_PREFIX) &&
          definition.steps.some(
            (step) => step.id === execution.stepId && step.mutatesState !== false,
          ),
      )
      .sort(
        (a, b) =>
          (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '') ||
          (stepIndex.get(b.stepId) ?? 0) - (stepIndex.get(a.stepId) ?? 0),
      );

    const compensatedSteps: string[] = [];
    const outstanding: WorkflowOutstandingStep[] = [];
    let attemptedAndFailed = false;

    for (const execution of completed) {
      const step = definition.steps.find((candidate) => candidate.id === execution.stepId);
      const name = step?.name ?? execution.stepId;
      const spec = definition.compensation?.find(
        (candidate) => candidate.forStepId === execution.stepId,
      );
      if (spec === undefined) {
        outstanding.push({
          stepId: execution.stepId,
          name,
          reason: 'no compensating action is defined for this step',
        });
        continue;
      }
      if (spec.requiresApproval) {
        outstanding.push({
          stepId: execution.stepId,
          name,
          reason: 'its compensation requires a separate human approval',
        });
        continue;
      }

      const journalStepId = `${COMPENSATION_STEP_PREFIX}${execution.stepId}`;
      const toolId = spec.toolId ?? spec.capabilityId;
      const input = resolveStepInput(spec.input, instance.input, {
        ...instance.state,
        [execution.stepId]: execution.output,
      });
      let record = await this.#executions.findByWorkflowAndStep(instance.id, journalStepId);
      if (record?.status === 'succeeded') {
        compensatedSteps.push(execution.stepId);
        continue;
      }
      if (record === undefined) {
        record = WorkflowStepExecution.create(
          {
            workflowId: instance.id,
            tenantId: instance.tenantId,
            stepId: journalStepId,
            name: `Compensate: ${name}`,
            capabilityId: spec.capabilityId,
            toolId,
            input,
          },
          this.#now(),
        );
      } else if (record.status === 'failed') {
        record.reopenForRetry(this.#now());
      }

      const attempt = record.attempt + 1;
      let failure: string | undefined;
      try {
        record.markRunning(attempt, this.#now());
        await this.#executions.save(record);
        const result = await this.#executor.execute({
          stepId: journalStepId,
          capabilityId: spec.capabilityId,
          toolId,
          input,
          purpose: 'compensation',
          // The compensation is bounded by the SAME initiating ceiling: it may
          // run only when the forward capability it undoes was itself
          // permitted (the compensating tool is workflow-internal and holds no
          // capability of its own).
          compensatesCapabilityId: execution.capabilityId,
          context: this.#invocationContext(instance),
          // The rollback undoes only what THIS approved workflow created, so
          // the workflow-level approval covers it (a compensation that needs
          // its own approval is skipped above and reported outstanding).
          approvalGranted: true,
          approvalBasis: instance.approvalId !== undefined ? 'approval_engine' : 'direct_human',
        });
        if (result.ok && !result.blocked) {
          record.succeed(result.output, this.#now());
        } else {
          failure = result.blocked
            ? 'compensation is waiting for approval'
            : (result.error?.message ?? 'compensation failed');
        }
      } catch (caught) {
        failure = toWorkflowError(caught).message;
      }

      if (failure === undefined) {
        await this.#executions.save(record);
        await this.#publish([
          workflowStepCompletedEvent(context, {
            workflowId: instance.id,
            tenantId: instance.tenantId,
            stepId: journalStepId,
            stepName: record.name,
            capabilityId: spec.capabilityId,
            toolId,
            attempt,
            output: record.output,
          }),
        ]);
        compensatedSteps.push(execution.stepId);
      } else {
        record.fail(failure, this.#now());
        await this.#executions.save(record);
        await this.#publish([
          workflowStepFailedEvent(context, {
            workflowId: instance.id,
            tenantId: instance.tenantId,
            stepId: journalStepId,
            stepName: record.name,
            capabilityId: spec.capabilityId,
            toolId,
            attempt,
            error: failure,
          }),
        ]);
        attemptedAndFailed = true;
        outstanding.push({
          stepId: execution.stepId,
          name,
          reason: `compensation failed: ${failure}`,
        });
      }
    }

    const status = attemptedAndFailed
      ? 'failed'
      : outstanding.length > 0
        ? 'partial'
        : compensatedSteps.length > 0
          ? 'compensated'
          : 'not_required';
    return { status, compensatedSteps, outstanding };
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
      (a, b) =>
        (order.get(a.stepId) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.stepId) ?? Number.MAX_SAFE_INTEGER),
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

  /**
   * The trusted context of an inner step/compensation invocation: scope from
   * the INSTANCE (never step input), the initiating actor, the initiating
   * run's ceiling, and lineage attribution (agent principal, delegation,
   * approval). Attribution is descriptive: per-step delegation checks are NOT
   * re-run (workflow-level authorization + approval covers the unit; the
   * ceiling bounds it).
   */
  #invocationContext(instance: WorkflowInstance): WorkflowStepInvocation['context'] {
    return {
      userId: instance.userId,
      tenantId: instance.tenantId,
      ...(instance.workspaceId === undefined ? {} : { workspaceId: instance.workspaceId }),
      runId: instance.correlationId,
      autonomyTier: 'supervised',
      ...(instance.allowedCapabilityIds === undefined
        ? {}
        : { allowedCapabilityIds: [...instance.allowedCapabilityIds] }),
      ...(instance.agentId === undefined ? {} : { agentId: instance.agentId }),
      ...(instance.delegationId === undefined ? {} : { delegationId: instance.delegationId }),
      ...(instance.approvalId === undefined ? {} : { approvalId: instance.approvalId }),
    };
  }

  /** The run context of an instance (from its trusted immutable fields). */
  #contextOf(instance: WorkflowInstance): WorkflowRunContext {
    return {
      userId: instance.userId,
      tenantId: instance.tenantId,
      workspaceId: instance.workspaceId,
      correlationId: instance.correlationId,
      ...(instance.allowedCapabilityIds === undefined
        ? {}
        : { allowedCapabilityIds: instance.allowedCapabilityIds }),
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

/** The plain `{{key}}` placeholders a definition's steps declare (its input contract). */
function declaredInputKeys(definition: {
  steps: readonly { input?: Record<string, unknown> }[];
}): Set<string> {
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
  return keys;
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
