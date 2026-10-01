/**
 * @nexora/application-hr — RevokeHire command.
 *
 * The compensating action of the hire step (saga semantics, SAD.md §12.7):
 * when a later workflow step fails, the employee the workflow created is
 * offboarded so no active, assignable employee is left behind. The record is
 * RETAINED (audit history) — the employment ends through the domain's own
 * lifecycle (`active → exiting → offboarded`), it is never deleted.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Employee } from '@nexora/domain-hr';

/** Reverts the hire of an employee inside an organization. */
export interface RevokeHireCommand {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The employee to offboard. */
  employeeId: string;
  /** The user on whose authority the rollback runs. */
  actorId: UserId;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /** Why the hire is being revoked (recorded on the domain event). */
  reason: string;
}

/** The outcome of a revoke-hire. */
export interface RevokeHireResult {
  /** The employee aggregate (status `offboarded`). */
  employee: Employee;
  /** Events emitted (empty when the employee was already offboarded). */
  events: readonly EventEnvelope[];
  /** `false` when the employee was already offboarded (idempotent replay). */
  changed: boolean;
}
