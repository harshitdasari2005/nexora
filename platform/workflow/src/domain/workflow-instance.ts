/**
 * @nexora/module-workflow — WorkflowInstance aggregate.
 *
 * The journaled workflow instance (SAD.md §12.4): one aggregate per running
 * workflow, owning its lifecycle status, trusted-context scope, input, and
 * accumulated state. All state changes flow through aggregate methods, which
 * enforce the transition table FIRST (validate → mutate → event) — no
 * partial mutation on an illegal transition. Step-level progress lives in
 * the {@link WorkflowStepExecution} journal, not on this aggregate.
 *
 * The context (tenant, user, workspace, correlation) is immutable and comes
 * exclusively from the trusted execution context — never from the LLM or
 * caller input.
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { EventEnvelope } from '@nexora/shared/events';
import type { CorrelationId, TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { WorkflowInstance as WorkflowInstanceContract } from '@nexora/contracts/workflow';

import type { WorkflowEventContext } from '../events/index.js';
import {
  workflowCancelledEvent,
  workflowCompletedEvent,
  workflowCreatedEvent,
  workflowFailedEvent,
  workflowStartedEvent,
  workflowWaitingForApprovalEvent,
} from '../events/index.js';
import { WorkflowStateTransitionError } from './errors.js';
import { canTransition, isTerminal, type WorkflowStatus } from './workflow-status.js';

/** Input for creating a {@link WorkflowInstance}. */
export interface CreateWorkflowInstanceInput {
  /** The executed definition. */
  definitionId: string;
  /** The stable definition key. */
  definitionKey: string;
  /** The definition version. */
  definitionVersion: number;
  /** Tenant (organization) the instance belongs to (trusted). */
  tenantId: TenantId;
  /** The initiating user (trusted). */
  userId: string;
  /** Workspace scope, when workspace-scoped (trusted). */
  workspaceId?: WorkspaceId;
  /** Correlation id of the originating execution (trusted). */
  correlationId: CorrelationId;
  /** The workflow input payload (user-controlled business values). */
  input: Record<string, unknown>;
}

/** A persistence snapshot of the {@link WorkflowInstance} aggregate. */
export interface WorkflowInstanceSnapshot {
  /** Instance id (`wfi_...`). */
  id: string;
  /** The executed definition. */
  definitionId: string;
  /** The stable definition key. */
  definitionKey: string;
  /** The definition version. */
  definitionVersion: number;
  /** Tenant scope. */
  tenantId: string;
  /** Initiating user. */
  userId: string;
  /** Workspace scope, when set. */
  workspaceId?: string;
  /** Correlation id. */
  correlationId: string;
  /** Lifecycle status. */
  status: WorkflowStatus;
  /** The workflow input. */
  input: Record<string, unknown>;
  /** Accumulated state from executed steps. */
  state: Record<string, unknown>;
  /** Final output, when completed. */
  output?: Record<string, unknown>;
  /** Failure message, when failed. */
  error?: string;
  /** The current step id, when running. */
  currentStepId?: string;
  /** ISO-8601 UTC times + version. */
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * The {@link WorkflowInstance} aggregate root.
 */
export class WorkflowInstance {
  #id: string;
  readonly #definitionId: string;
  readonly #definitionKey: string;
  readonly #definitionVersion: number;
  readonly #tenantId: TenantId;
  readonly #userId: string;
  readonly #workspaceId?: WorkspaceId;
  readonly #correlationId: CorrelationId;
  #status: WorkflowStatus;
  readonly #input: Record<string, unknown>;
  #state: Record<string, unknown>;
  #output?: Record<string, unknown>;
  #error?: string;
  #currentStepId?: string;
  #startedAt: string;
  #finishedAt?: string;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateWorkflowInstanceInput, createdAt: string) {
    this.#id = prefixedId('wfi');
    this.#definitionId = input.definitionId;
    this.#definitionKey = input.definitionKey;
    this.#definitionVersion = input.definitionVersion;
    this.#tenantId = input.tenantId;
    this.#userId = input.userId;
    this.#workspaceId = input.workspaceId;
    this.#correlationId = input.correlationId;
    this.#status = 'created';
    this.#input = { ...input.input };
    this.#state = {};
    this.#startedAt = createdAt;
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new instance in `created` status and records a
   * {@link workflowCreatedEvent}. No instance exists before validation
   * succeeds — callers validate the definition and input first.
   */
  static create(
    input: CreateWorkflowInstanceInput,
    context: WorkflowEventContext,
    now = nowIso(),
  ): WorkflowInstance {
    const instance = new WorkflowInstance(input, now);
    instance.#events.push(
      workflowCreatedEvent(context, instance.#id, {
        workflowId: instance.#id,
        definitionKey: instance.#definitionKey,
        tenantId: instance.#tenantId,
        status: instance.#status,
      }),
    );
    return instance;
  }

  /** Instance id (`wfi_...`). */
  get id(): string {
    return this.#id;
  }

  /** The executed definition id. */
  get definitionId(): string {
    return this.#definitionId;
  }

  /** The stable definition key. */
  get definitionKey(): string {
    return this.#definitionKey;
  }

  /** The definition version. */
  get definitionVersion(): number {
    return this.#definitionVersion;
  }

  /** Tenant (organization) scope — immutable. */
  get tenantId(): TenantId {
    return this.#tenantId;
  }

  /** The initiating user — immutable. */
  get userId(): string {
    return this.#userId;
  }

  /** Workspace scope, when set — immutable. */
  get workspaceId(): WorkspaceId | undefined {
    return this.#workspaceId;
  }

  /** Correlation id of the originating execution. */
  get correlationId(): CorrelationId {
    return this.#correlationId;
  }

  /** The lifecycle status. */
  get status(): WorkflowStatus {
    return this.#status;
  }

  /** The workflow input (user-controlled business values). */
  get input(): Record<string, unknown> {
    return { ...this.#input };
  }

  /** The accumulated step state. */
  get state(): Record<string, unknown> {
    return { ...this.#state };
  }

  /** The final output, when completed. */
  get output(): Record<string, unknown> | undefined {
    return this.#output;
  }

  /** The failure message, when failed. */
  get error(): string | undefined {
    return this.#error;
  }

  /** The current step id, when running. */
  get currentStepId(): string | undefined {
    return this.#currentStepId;
  }

  /** ISO-8601 UTC time the instance was created. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time the instance started. */
  get startedAt(): string {
    return this.#startedAt;
  }

  /** ISO-8601 UTC time the instance finished, when finished. */
  get finishedAt(): string | undefined {
    return this.#finishedAt;
  }

  /** ISO-8601 UTC time of the last mutation. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version (optimistic concurrency). */
  get version(): number {
    return this.#version;
  }

  /** Whether the instance can still make progress. */
  isActive(): boolean {
    return !isTerminal(this.#status);
  }

  /** Whether the instance reached a terminal state. */
  isTerminal(): boolean {
    return isTerminal(this.#status);
  }

  /** Whether the instance is currently running (executing steps). */
  isRunning(): boolean {
    return this.#status === 'running';
  }

  /** Advances the lifecycle: `created → planning`. */
  plan(now = nowIso()): void {
    this.#transitionTo('planning', 'plan', now);
  }

  /** Advances the lifecycle: `planning → ready`. */
  ready(now = nowIso()): void {
    this.#transitionTo('ready', 'ready', now);
  }

  /** Starts execution: `ready → running` (records {@link workflowStartedEvent}). */
  start(context: WorkflowEventContext, now = nowIso()): void {
    this.#transitionTo('running', 'start', now);
    this.#events.push(
      workflowStartedEvent(context, this.#id, { workflowId: this.#id, tenantId: this.#tenantId }),
    );
  }

  /**
   * Pauses for a step approval: `running → awaiting_approval` (records
   * {@link workflowWaitingForApprovalEvent}). No step executes while the
   * instance waits.
   */
  waitForApproval(stepId: string, context: WorkflowEventContext, now = nowIso()): void {
    this.#transitionTo('awaiting_approval', 'wait for approval', now);
    this.#currentStepId = stepId;
    this.#events.push(
      workflowWaitingForApprovalEvent(context, this.#id, {
        workflowId: this.#id,
        stepId,
        tenantId: this.#tenantId,
      }),
    );
  }

  /** Resumes after an approved decision: `awaiting_approval → running`. */
  resume(now = nowIso()): void {
    this.#transitionTo('running', 'resume', now);
  }

  /** Merges a step output into the accumulated state (validated when running). */
  mergeState(key: string, value: unknown, now = nowIso()): void {
    if (this.#status !== 'running') {
      throw new WorkflowStateTransitionError({
        workflowId: this.#id,
        from: this.#status,
        to: 'running',
        action: 'merge state while',
      });
    }
    this.#state = { ...this.#state, [key]: value };
    this.#bump(now);
  }

  /** Completes the workflow: `running → succeeded` (records {@link workflowCompletedEvent}). */
  complete(
    output: Record<string, unknown> | undefined,
    context: WorkflowEventContext,
    now = nowIso(),
  ): void {
    this.#transitionTo('succeeded', 'complete', now);
    this.#output = output;
    this.#finishedAt = now;
    this.#events.push(
      workflowCompletedEvent(context, this.#id, {
        workflowId: this.#id,
        definitionKey: this.#definitionKey,
        tenantId: this.#tenantId,
        output,
      }),
    );
  }

  /** Fails the workflow: `running|awaiting_approval → failed` (records {@link workflowFailedEvent}). */
  fail(error: string, context: WorkflowEventContext, now = nowIso()): void {
    this.#transitionTo('failed', 'fail', now);
    this.#error = error;
    this.#finishedAt = now;
    this.#events.push(
      workflowFailedEvent(context, this.#id, {
        workflowId: this.#id,
        definitionKey: this.#definitionKey,
        tenantId: this.#tenantId,
        error,
      }),
    );
  }

  /** Cancels the workflow: `running|awaiting_approval → cancelled`. */
  cancel(context: WorkflowEventContext, now = nowIso()): void {
    this.#transitionTo('cancelled', 'cancel', now);
    this.#finishedAt = now;
    this.#events.push(
      workflowCancelledEvent(context, this.#id, {
        workflowId: this.#id,
        definitionKey: this.#definitionKey,
        tenantId: this.#tenantId,
      }),
    );
  }

  /** Produces a persistence snapshot. */
  static snapshot(instance: WorkflowInstance): WorkflowInstanceSnapshot {
    return {
      id: instance.id,
      definitionId: instance.definitionId,
      definitionKey: instance.definitionKey,
      definitionVersion: instance.definitionVersion,
      tenantId: instance.tenantId,
      userId: instance.userId,
      workspaceId: instance.workspaceId,
      correlationId: instance.correlationId,
      status: instance.status,
      input: instance.input,
      state: instance.state,
      output: instance.output,
      error: instance.error,
      currentStepId: instance.currentStepId,
      startedAt: instance.startedAt,
      finishedAt: instance.finishedAt,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      version: instance.version,
    };
  }

  /** Reconstructs an instance from a snapshot without emitting events. */
  static hydrate(snapshot: WorkflowInstanceSnapshot): WorkflowInstance {
    const instance = new WorkflowInstance(
      {
        definitionId: snapshot.definitionId,
        definitionKey: snapshot.definitionKey,
        definitionVersion: snapshot.definitionVersion,
        tenantId: snapshot.tenantId as TenantId,
        userId: snapshot.userId,
        workspaceId: snapshot.workspaceId as WorkspaceId | undefined,
        correlationId: snapshot.correlationId,
        input: snapshot.input,
      },
      snapshot.createdAt,
    );
    instance.#id = snapshot.id;
    instance.#status = snapshot.status;
    instance.#state = { ...snapshot.state };
    instance.#output = snapshot.output;
    instance.#error = snapshot.error;
    instance.#currentStepId = snapshot.currentStepId;
    instance.#startedAt = snapshot.startedAt;
    instance.#finishedAt = snapshot.finishedAt;
    instance.#updatedAt = snapshot.updatedAt;
    instance.#version = snapshot.version;
    return instance;
  }

  /** Converts to the canonical contract shape. */
  toContract(): WorkflowInstanceContract {
    return {
      id: this.id,
      definitionId: this.definitionId,
      definitionKey: this.definitionKey,
      tenantId: this.tenantId,
      userId: this.userId,
      workspaceId: this.workspaceId,
      correlationId: this.correlationId,
      status: this.status,
      currentStepId: this.currentStepId,
      error: this.error,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Enforces the transition table (validate → mutate). */
  #transitionTo(target: WorkflowStatus, action: string, now: string): void {
    if (!canTransition(this.#status, target)) {
      throw new WorkflowStateTransitionError({
        workflowId: this.#id,
        from: this.#status,
        to: target,
        action,
      });
    }
    this.#status = target;
    this.#bump(now);
  }

  /** Bumps the version and updated-at timestamp. */
  #bump(now: string): void {
    this.#version += 1;
    this.#updatedAt = now;
  }
}
