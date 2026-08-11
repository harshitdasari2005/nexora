/**
 * @nexora/application-projects — AssignEmployeeToProject command.
 *
 * The vertical-slice use case that assigns an employee to a project
 * (DOMAIN_MODEL.md §14.2 Projects `assign_resource`, EVT-9
 * `ResourceAssigned`). The employee is resolved by the HR bounded context
 * at the orchestration boundary and arrives here as a trusted employee id —
 * the Projects application layer never reaches into HR. Only `active`
 * projects are assignable; duplicate assignments are rejected by the domain.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { ResourceAssignment } from '@nexora/domain-projects';

/** Assigns a resolved employee to a project inside an organization. */
export interface AssignEmployeeToProjectCommand {
  /** The owning organization (tenant) id — trusted server-side scope. */
  organizationId: TenantId;
  /** The project id (already resolved and tenant-checked by the caller). */
  projectId: string;
  /** The employee id (already resolved and permission-checked by the caller). */
  employeeId: string;
  /** The user that requests the assignment. */
  actorId: UserId;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful assignment. */
export interface AssignEmployeeToProjectResult {
  /** The created assignment aggregate. */
  assignment: ResourceAssignment;
  /** Domain events emitted by the use case (`project.resource_assigned`). */
  events: readonly EventEnvelope[];
}
