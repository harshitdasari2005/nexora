/**
 * @nexora/domain-hr — domain events.
 *
 * The HR bounded context event vocabulary (DOMAIN_MODEL.md §14.1: the
 * Employee lifecycle and EVT-1/EVT-3/EVT-4). HR is a *Supporting* domain
 * (DOMAIN_MODEL.md DOM-04), so HR events ride the canonical
 * `@nexora/shared/events` envelope with category `hr`; the platform event-bus
 * (SAD.md §11) consumes this shape.
 *
 * Every event carries the organization (tenant) id (context contract) and
 * the employee id.
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId } from '@nexora/contracts/common';

import type { EmployeeId } from '../value-objects/employee-id.js';

/** Category applied to every HR domain event (DOM-04 Supporting). */
export const HR_EVENT_CATEGORY = 'hr' as const;

/** Stable event type names (EVT-* catalog, DOMAIN_MODEL.md §14.1). */
export const EMPLOYEE_EVENT_TYPES = {
  employeeCreated: 'employee.created',
  employeeActivated: 'employee.activated',
} as const;

/** Payload of the {@link employeeCreatedEvent}. */
export interface EmployeeCreatedPayload {
  /** The created employee. */
  employeeId: EmployeeId;
  /** The name at creation time. */
  name: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The initial employment status (`proposed`). */
  status: string;
}

/** Payload of the {@link employeeActivatedEvent}. */
export interface EmployeeActivatedPayload {
  /** The activated employee. */
  employeeId: EmployeeId;
}

/** Context required to emit an HR domain event. */
export interface EmployeeEventContext {
  /** The actor that caused the event. */
  actor: EventActor;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
}

/** Creates a typed HR domain event envelope with canonical metadata. */
function employeeEvent<P>(
  type: string,
  context: EmployeeEventContext,
  employeeId: EmployeeId,
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
      category: HR_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** An employee record was created (employee.created — EVT-1 hire record). */
export function employeeCreatedEvent(
  context: EmployeeEventContext,
  employeeId: EmployeeId,
  payload: EmployeeCreatedPayload,
): EventEnvelope<EmployeeCreatedPayload> {
  return employeeEvent(EMPLOYEE_EVENT_TYPES.employeeCreated, context, employeeId, payload);
}

/** An employee became active (employee.activated — EVT-3 onboarding complete). */
export function employeeActivatedEvent(
  context: EmployeeEventContext,
  employeeId: EmployeeId,
): EventEnvelope<EmployeeActivatedPayload> {
  return employeeEvent(EMPLOYEE_EVENT_TYPES.employeeActivated, context, employeeId, {
    employeeId,
  });
}
