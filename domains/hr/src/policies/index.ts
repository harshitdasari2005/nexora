/**
 * @nexora/domain-hr — domain policies.
 *
 * The HR bounded context business rules (DOMAIN_MODEL.md §14.1), extracted so
 * the platform can reuse them and so aggregate invariants stay in one
 * authoritative place. Policies are pure: they have no I/O and throw typed
 * domain errors on violation.
 */

import { InvalidEmployeeValueError, EmployeeStateTransitionError } from '../errors/index.js';
import type { EmployeeStatusValue } from '../value-objects/employee-status.js';
import { type EmployeeStatus } from '../value-objects/employee-status.js';

/**
 * The employee lifecycle transition table (DOMAIN_MODEL.md §14.1):
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Proposed
 *     Proposed --> Hired: offer accepted (EVT-1)
 *     Hired --> Onboarding: onboarding starts (WRK-2)
 *     Onboarding --> Active: checklist complete (EVT-3)
 *     Active --> OnLeave: leave approved
 *     OnLeave --> Active: return
 *     Active --> Exiting: offboarding requested (WRK-3)
 *     Exiting --> Offboarded: access revoked + final pay (EVT-4)
 *     Proposed --> Cancelled: offer declined
 * ```
 *
 * The single authoritative definition — the Employee aggregate and all
 * policies consult it. `offboarded` and `cancelled` are terminal.
 */
export const EMPLOYEE_TRANSITIONS: Readonly<
  Record<EmployeeStatusValue, readonly EmployeeStatusValue[]>
> = {
  proposed: ['hired', 'cancelled'],
  hired: ['onboarding'],
  onboarding: ['active'],
  active: ['on_leave', 'exiting'],
  on_leave: ['active', 'exiting'],
  exiting: ['offboarded'],
  offboarded: [],
  cancelled: [],
};

/**
 * Employee lifecycle rules: allowed status transitions (DOMAIN_MODEL.md
 * §14.1). Every transition must be explicit and validated before mutation.
 */
export class EmployeeLifecyclePolicy {
  /** The statuses reachable from the given status. */
  allowedTargets(current: EmployeeStatus): readonly EmployeeStatusValue[] {
    return EMPLOYEE_TRANSITIONS[current.value];
  }

  /**
   * Asserts the employee may transition to the target status.
   *
   * @throws {EmployeeStateTransitionError} when the transition is not allowed.
   */
  assertCanTransition(current: EmployeeStatus, target: EmployeeStatus): void {
    const allowed = this.allowedTargets(current);
    if (!allowed.includes(target.value)) {
      throw new EmployeeStateTransitionError(
        `Cannot transition an employee from ${current.value} to ${target.value}`,
        { from: current.value, to: target.value },
      );
    }
  }
}

/**
 * Employee value invariants (DOMAIN_MODEL.md §14): an employee name is
 * required and bounded by the platform name limit.
 */
export class EmployeeValuePolicy {
  /**
   * Asserts an employee name is non-empty and within the platform name limit.
   *
   * @throws {InvalidEmployeeValueError} when the name is empty or too long.
   */
  assertValidName(name: string, maxLength = 120): void {
    const value = name.trim();
    const issues: { path: string; message: string }[] = [];
    if (value.length === 0) {
      issues.push({ path: 'name', message: 'Must not be empty' });
    } else if (value.length > maxLength) {
      issues.push({ path: 'name', message: `Must be at most ${maxLength} characters` });
    }
    if (issues.length > 0) {
      throw new InvalidEmployeeValueError('Invalid employee name', issues);
    }
  }
}
