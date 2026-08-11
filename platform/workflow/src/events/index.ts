/**
 * @nexora/module-workflow — workflow events.
 *
 * The workflow bounded context event vocabulary (EVT-* catalog, category
 * `workflow`). Events ride the canonical `@nexora/shared/events` envelope
 * (SAD.md §11) and carry the trusted scope: tenant, workspace, correlation
 * id, and the initiating actor — so the event stream is fully auditable.
 *
 * Event types:
 *   workflow.created                — an instance was created
 *   workflow.started                — an instance began executing
 *   workflow.step.started           — a step attempt began
 *   workflow.step.completed         — a step attempt succeeded
 *   workflow.step.failed            — a step attempt failed
 *   workflow.waiting_for_approval   — the instance paused for a step approval
 *   workflow.completed              — the instance succeeded
 *   workflow.failed                 — the instance failed
 *   workflow.cancelled              — the instance was cancelled
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** Category applied to every workflow event. */
export const WORKFLOW_EVENT_CATEGORY = 'workflow' as const;

/** Stable workflow event type names. */
export const WORKFLOW_EVENT_TYPES = {
  workflowCreated: 'workflow.created',
  workflowStarted: 'workflow.started',
  stepStarted: 'workflow.step.started',
  stepCompleted: 'workflow.step.completed',
  stepFailed: 'workflow.step.failed',
  waitingForApproval: 'workflow.waiting_for_approval',
  workflowCompleted: 'workflow.completed',
  workflowFailed: 'workflow.failed',
  workflowCancelled: 'workflow.cancelled',
} as const;

/** Payload of the {@link workflowCreatedEvent}. */
export interface WorkflowCreatedPayload {
  /** The created instance. */
  workflowId: string;
  /** The stable definition key. */
  definitionKey: string;
  /** Tenant (organization) scope. */
  tenantId: TenantId;
  /** The initial lifecycle status (`created`). */
  status: string;
}

/** Payload of the {@link workflowStartedEvent}. */
export interface WorkflowStartedPayload {
  workflowId: string;
  tenantId: TenantId;
}

/** Payload of the {@link workflowStepStartedEvent} / completed / failed. */
export interface WorkflowStepEventPayload {
  workflowId: string;
  tenantId: TenantId;
  /** The executed step id. */
  stepId: string;
  /** The step name. */
  stepName: string;
  /** The capability executed. */
  capabilityId: string;
  /** The tool invoked. */
  toolId: string;
  /** The 1-based attempt number. */
  attempt: number;
}

/** Payload of the {@link workflowStepCompletedEvent}. */
export interface WorkflowStepCompletedPayload extends WorkflowStepEventPayload {
  /** The tool output on success. */
  output?: unknown;
}

/** Payload of the {@link workflowStepFailedEvent}. */
export interface WorkflowStepFailedPayload extends WorkflowStepEventPayload {
  /** The failure message. */
  error: string;
}

/** Payload of the {@link workflowWaitingForApprovalEvent}. */
export interface WorkflowWaitingForApprovalPayload {
  workflowId: string;
  tenantId: TenantId;
  /** The step waiting for approval. */
  stepId: string;
}

/** Payload of the {@link workflowCompletedEvent}. */
export interface WorkflowCompletedPayload {
  workflowId: string;
  definitionKey: string;
  tenantId: TenantId;
  /** The final output. */
  output?: Record<string, unknown>;
}

/** Payload of the {@link workflowFailedEvent}. */
export interface WorkflowFailedPayload {
  workflowId: string;
  definitionKey: string;
  tenantId: TenantId;
  /** The failure message. */
  error: string;
}

/** Payload of the {@link workflowCancelledEvent}. */
export interface WorkflowCancelledPayload {
  workflowId: string;
  definitionKey: string;
  tenantId: TenantId;
}

/** Context required to emit a workflow event (trusted scope). */
export interface WorkflowEventContext {
  /** The actor that caused the event. */
  actor: EventActor;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /** Tenant (organization) scope. */
  tenantId: TenantId;
  /** Workspace scope, when workspace-scoped. */
  workspaceId?: WorkspaceId;
}

/** Creates a typed workflow event envelope with canonical metadata. */
function workflowEvent<P>(
  type: string,
  context: WorkflowEventContext,
  payload: P,
  version = 1,
): EventEnvelope<P> {
  return createEventEnvelope({
    type,
    version,
    actor: context.actor,
    correlationId: context.correlationId,
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    payload,
    metadata: {
      version,
      category: WORKFLOW_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** A workflow instance was created (workflow.created). */
export function workflowCreatedEvent(
  context: WorkflowEventContext,
  workflowId: string,
  payload: WorkflowCreatedPayload,
): EventEnvelope<WorkflowCreatedPayload> {
  return workflowEvent(WORKFLOW_EVENT_TYPES.workflowCreated, context, payload);
}

/** A workflow instance began executing (workflow.started). */
export function workflowStartedEvent(
  context: WorkflowEventContext,
  workflowId: string,
  payload: WorkflowStartedPayload,
): EventEnvelope<WorkflowStartedPayload> {
  return workflowEvent(WORKFLOW_EVENT_TYPES.workflowStarted, context, payload);
}

/** A step attempt began (workflow.step.started). */
export function workflowStepStartedEvent(
  context: WorkflowEventContext,
  payload: WorkflowStepEventPayload,
): EventEnvelope<WorkflowStepEventPayload> {
  return workflowEvent(WORKFLOW_EVENT_TYPES.stepStarted, context, payload);
}

/** A step attempt succeeded (workflow.step.completed). */
export function workflowStepCompletedEvent(
  context: WorkflowEventContext,
  payload: WorkflowStepCompletedPayload,
): EventEnvelope<WorkflowStepCompletedPayload> {
  return workflowEvent(WORKFLOW_EVENT_TYPES.stepCompleted, context, payload);
}

/** A step attempt failed (workflow.step.failed). */
export function workflowStepFailedEvent(
  context: WorkflowEventContext,
  payload: WorkflowStepFailedPayload,
): EventEnvelope<WorkflowStepFailedPayload> {
  return workflowEvent(WORKFLOW_EVENT_TYPES.stepFailed, context, payload);
}

/** The instance paused for a step approval (workflow.waiting_for_approval). */
export function workflowWaitingForApprovalEvent(
  context: WorkflowEventContext,
  workflowId: string,
  payload: WorkflowWaitingForApprovalPayload,
): EventEnvelope<WorkflowWaitingForApprovalPayload> {
  return workflowEvent(WORKFLOW_EVENT_TYPES.waitingForApproval, context, payload);
}

/** The instance succeeded (workflow.completed). */
export function workflowCompletedEvent(
  context: WorkflowEventContext,
  workflowId: string,
  payload: WorkflowCompletedPayload,
): EventEnvelope<WorkflowCompletedPayload> {
  return workflowEvent(WORKFLOW_EVENT_TYPES.workflowCompleted, context, payload);
}

/** The instance failed (workflow.failed). */
export function workflowFailedEvent(
  context: WorkflowEventContext,
  workflowId: string,
  payload: WorkflowFailedPayload,
): EventEnvelope<WorkflowFailedPayload> {
  return workflowEvent(WORKFLOW_EVENT_TYPES.workflowFailed, context, payload);
}

/** The instance was cancelled (workflow.cancelled). */
export function workflowCancelledEvent(
  context: WorkflowEventContext,
  workflowId: string,
  payload: WorkflowCancelledPayload,
): EventEnvelope<WorkflowCancelledPayload> {
  return workflowEvent(WORKFLOW_EVENT_TYPES.workflowCancelled, context, payload);
}
