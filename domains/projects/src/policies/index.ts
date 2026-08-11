/**
 * @nexora/domain-projects — domain policies.
 *
 * The Projects bounded context business rules (DOMAIN_MODEL.md §14.2),
 * extracted so the platform can reuse them and so aggregate invariants stay
 * in one authoritative place. Policies are pure: they have no I/O and throw
 * typed domain errors on violation.
 */

import { InvalidProjectValueError, ProjectStateTransitionError } from '../errors/index.js';
import type { ProjectStatusValue } from '../value-objects/project-status.js';
import { type ProjectStatus } from '../value-objects/project-status.js';

/**
 * The project lifecycle transition table (DOMAIN_MODEL.md §14.2):
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Proposed
 *     Proposed --> Active: charter approved (WRK-4)
 *     Active --> OnHold: authorized pause
 *     OnHold --> Active: resume
 *     Active --> Completed: owner closes (EVT-9)
 *     Completed --> Archived: retention policy
 *     Proposed --> Cancelled
 *     Active --> Cancelled: owner + approval
 * ```
 *
 * The single authoritative definition — the Project aggregate and all
 * policies consult it. `archived` and `cancelled` are terminal in v1.
 */
export const PROJECT_TRANSITIONS: Readonly<
  Record<ProjectStatusValue, readonly ProjectStatusValue[]>
> = {
  proposed: ['active', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active'],
  completed: ['archived'],
  archived: [],
  cancelled: [],
};

/**
 * Project lifecycle rules: allowed status transitions (DOMAIN_MODEL.md
 * §14.2). Every transition must be explicit and validated before mutation.
 */
export class ProjectLifecyclePolicy {
  /** The statuses reachable from the given status. */
  allowedTargets(current: ProjectStatus): readonly ProjectStatusValue[] {
    return PROJECT_TRANSITIONS[current.value];
  }

  /**
   * Asserts the project may transition to the target status.
   *
   * @throws {ProjectStateTransitionError} when the transition is not allowed.
   */
  assertCanTransition(current: ProjectStatus, target: ProjectStatus): void {
    const allowed = this.allowedTargets(current);
    if (!allowed.includes(target.value)) {
      throw new ProjectStateTransitionError(
        `Cannot transition a project from ${current.value} to ${target.value}`,
        { from: current.value, to: target.value },
      );
    }
  }
}

/**
 * Project value invariants (DOMAIN_MODEL.md §14): a project name is
 * required; the description, when present, is bounded.
 */
export class ProjectValuePolicy {
  /**
   * Asserts a project name is non-empty and within the platform name limit.
   *
   * @throws {InvalidProjectValueError} when the name is empty or too long.
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
      throw new InvalidProjectValueError('Invalid project name', issues);
    }
  }

  /**
   * Asserts a project description, when present, is within the bound.
   *
   * @throws {InvalidProjectValueError} when the description is too long.
   */
  assertValidDescription(description: string | undefined, maxLength = 2000): void {
    const value = description?.trim();
    if (value !== undefined && value.length > 0 && value.length > maxLength) {
      throw new InvalidProjectValueError('Invalid project description', [
        { path: 'description', message: `Must be at most ${maxLength} characters` },
      ]);
    }
  }
}
