/**
 * @nexora/domain-projects — domain events.
 *
 * The Projects bounded context event vocabulary (DOMAIN_MODEL.md §14
 * Projects: `ProjectCreated`, plus lifecycle transitions). Projects is a
 * *Supporting* domain (DOMAIN_MODEL.md DOM-05), so project events ride the
 * canonical `@nexora/shared/events` envelope with category `projects`; the
 * platform event-bus (SAD.md §11) consumes this shape.
 *
 * Every event carries the organization (tenant) id (context contract) and
 * the project id.
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId } from '@nexora/contracts/common';

import type { AssignmentId } from '../value-objects/assignment-id.js';
import type { ProjectId } from '../value-objects/project-id.js';

/** Category applied to every Projects domain event (DOM-05 Supporting). */
export const PROJECTS_EVENT_CATEGORY = 'projects' as const;

/** Stable event type names (EVT-* catalog, DOMAIN_MODEL.md §14). */
export const PROJECT_EVENT_TYPES = {
  projectCreated: 'project.created',
  projectActivated: 'project.activated',
  projectOnHold: 'project.on_hold',
  projectResumed: 'project.resumed',
  projectCompleted: 'project.completed',
  projectArchived: 'project.archived',
  projectCancelled: 'project.cancelled',
  resourceAssigned: 'project.resource_assigned',
} as const;

/** Payload of the {@link projectCreatedEvent}. */
export interface ProjectCreatedPayload {
  /** The created project. */
  projectId: ProjectId;
  /** The name at creation time. */
  name: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The initial lifecycle status (`proposed`). */
  status: string;
}

/** Payload of the {@link projectActivatedEvent}. */
export interface ProjectActivatedPayload {
  /** The activated project. */
  projectId: ProjectId;
}

/** Payload of the {@link projectOnHoldEvent}. */
export interface ProjectOnHoldPayload {
  /** The paused project. */
  projectId: ProjectId;
  /** Why the project was paused (authorized pause). */
  reason: string;
}

/** Payload of the {@link projectResumedEvent}. */
export interface ProjectResumedPayload {
  /** The resumed project. */
  projectId: ProjectId;
}

/** Payload of the {@link projectCompletedEvent}. */
export interface ProjectCompletedPayload {
  /** The completed project. */
  projectId: ProjectId;
}

/** Payload of the {@link projectArchivedEvent}. */
export interface ProjectArchivedPayload {
  /** The archived project. */
  projectId: ProjectId;
  /** Why the project was archived (retention policy). */
  reason: string;
}

/** Payload of the {@link projectCancelledEvent}. */
export interface ProjectCancelledPayload {
  /** The cancelled project. */
  projectId: ProjectId;
  /** Why the project was cancelled. */
  reason: string;
}

/** Payload of the {@link resourceAssignedEvent}. */
export interface ResourceAssignedPayload {
  /** The created assignment. */
  assignmentId: AssignmentId;
  /** The project the employee was assigned to. */
  projectId: ProjectId;
  /** The assigned employee id (HR bounded context reference). */
  employeeId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
}

/** Context required to emit a Projects domain event. */
export interface ProjectEventContext {
  /** The actor that caused the event. */
  actor: EventActor;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
}

/** Creates a typed Projects domain event envelope with canonical metadata. */
function projectEvent<P>(
  type: string,
  context: ProjectEventContext,
  projectId: ProjectId,
  payload: P,
  version = 1,
): EventEnvelope<P> {
  return createEventEnvelope({
    type,
    version,
    actor: context.actor,
    correlationId: context.correlationId,
    tenantId: context.organizationId,
    payload,
    metadata: {
      version,
      category: PROJECTS_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** A project was created (project.created). */
export function projectCreatedEvent(
  context: ProjectEventContext,
  projectId: ProjectId,
  payload: ProjectCreatedPayload,
): EventEnvelope<ProjectCreatedPayload> {
  return projectEvent(PROJECT_EVENT_TYPES.projectCreated, context, projectId, payload);
}

/** A project was activated (project.activated — charter approved, WRK-4). */
export function projectActivatedEvent(
  context: ProjectEventContext,
  projectId: ProjectId,
): EventEnvelope<ProjectActivatedPayload> {
  return projectEvent(PROJECT_EVENT_TYPES.projectActivated, context, projectId, {
    projectId,
  });
}

/** A project was paused (project.on_hold — authorized pause). */
export function projectOnHoldEvent(
  context: ProjectEventContext,
  projectId: ProjectId,
  reason: string,
): EventEnvelope<ProjectOnHoldPayload> {
  return projectEvent(PROJECT_EVENT_TYPES.projectOnHold, context, projectId, {
    projectId,
    reason,
  });
}

/** A project was resumed (project.resumed). */
export function projectResumedEvent(
  context: ProjectEventContext,
  projectId: ProjectId,
): EventEnvelope<ProjectResumedPayload> {
  return projectEvent(PROJECT_EVENT_TYPES.projectResumed, context, projectId, {
    projectId,
  });
}

/** A project was completed (project.completed — owner closes, EVT-9). */
export function projectCompletedEvent(
  context: ProjectEventContext,
  projectId: ProjectId,
): EventEnvelope<ProjectCompletedPayload> {
  return projectEvent(PROJECT_EVENT_TYPES.projectCompleted, context, projectId, {
    projectId,
  });
}

/** A project was archived (project.archived — retention policy). */
export function projectArchivedEvent(
  context: ProjectEventContext,
  projectId: ProjectId,
  reason: string,
): EventEnvelope<ProjectArchivedPayload> {
  return projectEvent(PROJECT_EVENT_TYPES.projectArchived, context, projectId, {
    projectId,
    reason,
  });
}

/** A project was cancelled (project.cancelled). */
export function projectCancelledEvent(
  context: ProjectEventContext,
  projectId: ProjectId,
  reason: string,
): EventEnvelope<ProjectCancelledPayload> {
  return projectEvent(PROJECT_EVENT_TYPES.projectCancelled, context, projectId, {
    projectId,
    reason,
  });
}

/** An employee was assigned to a project (project.resource_assigned — EVT-9, ResourceAssigned). */
export function resourceAssignedEvent(
  context: ProjectEventContext,
  assignmentId: AssignmentId,
  payload: ResourceAssignedPayload,
): EventEnvelope<ResourceAssignedPayload> {
  return projectEvent(PROJECT_EVENT_TYPES.resourceAssigned, context, payload.projectId, payload);
}
