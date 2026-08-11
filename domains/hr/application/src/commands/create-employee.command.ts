/**
 * @nexora/application-hr — CreateEmployee command.
 *
 * The vertical-slice use case that creates an employee record inside an
 * organization (DOMAIN_MODEL.md §14.1): the record is drafted in `proposed`
 * and, in v1, immediately moved through hire → onboard → active by the
 * application service so the employee is assignable (BR-16) — the full
 * hire/onboarding workflows (WRK-2/3) land in later sprints.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Employee } from '@nexora/domain-hr';

/** Creates a new employee record in an organization. */
export interface CreateEmployeeCommand {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The employee name. */
  name: string;
  /** The user that creates the record. */
  actorId: UserId;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful employee creation. */
export interface CreateEmployeeResult {
  /** The created (active) employee aggregate. */
  employee: Employee;
  /** Domain events emitted by the use case (created/hired/onboarded/activated). */
  events: readonly EventEnvelope[];
}
