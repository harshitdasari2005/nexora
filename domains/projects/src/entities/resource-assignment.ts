/**
 * @nexora/domain-projects — ResourceAssignment aggregate root.
 *
 * The assignment of an employee to a project (DOMAIN_MODEL.md §14.2
 * Projects: `ResourceAssignment`). The aggregate lives in the **Projects**
 * bounded context and references the employee **by id** (AP-13: aggregates
 * never hold object graphs of other aggregates) — the employee record itself
 * is owned by the HR bounded context. The assignment carries the owning
 * organization (tenant) id so it can be scoped and audited independently.
 *
 * Invariants:
 * - An employee may be assigned to a project at most once (duplicate
 *   assignment protection) — enforced by the repository at creation.
 * - The assignment belongs to exactly one organization (the tenant scope of
 *   the project, immutable at creation).
 *
 * All state changes flow through aggregate methods, which record domain
 * events. The aggregate is created `active`; no partial mutation on failure.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId } from '@nexora/contracts/common';

import type { ProjectEventContext } from '../events/index.js';
import { resourceAssignedEvent } from '../events/index.js';
import type { ProjectId } from '../value-objects/project-id.js';
import { AssignmentId } from '../value-objects/assignment-id.js';

/** Input for creating a new {@link ResourceAssignment}. */
export interface AssignResourceInput {
  /** The project the employee is assigned to. */
  projectId: ProjectId;
  /** The employee id (owned by the HR bounded context). */
  employeeId: string;
  /** The owning organization (tenant) id — immutable. */
  organizationId: TenantId;
}

/**
 * A persistence snapshot of the {@link ResourceAssignment} aggregate
 * (PERSISTENCE.md §4 aggregate ownership). Plain data produced by
 * {@link ResourceAssignment.snapshot} and consumed by
 * {@link ResourceAssignment.hydrate} — no behavior.
 */
export interface ResourceAssignmentSnapshot {
  /** The assignment id. */
  id: AssignmentId;
  /** The project the employee is assigned to. */
  projectId: ProjectId;
  /** The employee id (HR bounded context reference). */
  employeeId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** ISO-8601 UTC creation (assignment) time. */
  assignedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link ResourceAssignment} aggregate root. Use
 * {@link ResourceAssignment.create} to construct; the domain service enforces
 * the duplicate-assignment and project-lifecycle invariants around it.
 */
export class ResourceAssignment {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: AssignmentId;
  readonly #projectId: ProjectId;
  readonly #employeeId: string;
  readonly #organizationId: TenantId;
  readonly #assignedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: AssignResourceInput, assignedAt: string) {
    this.#id = AssignmentId.create();
    this.#projectId = input.projectId;
    this.#employeeId = input.employeeId;
    this.#organizationId = input.organizationId;
    this.#assignedAt = assignedAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link ResourceAssignment} and records a
   * {@link resourceAssignedEvent} (`project.resource_assigned`).
   *
   * @param input   - the project, employee, and tenant.
   * @param context - event context (actor, correlation id, organization id).
   * @param now     - ISO-8601 UTC assignment time (defaults to now).
   */
  static create(
    input: AssignResourceInput,
    context: ProjectEventContext,
    now = nowIso(),
  ): ResourceAssignment {
    const assignment = new ResourceAssignment(input, now);
    assignment.#events.push(
      resourceAssignedEvent(context, assignment.#id, {
        assignmentId: assignment.#id,
        projectId: assignment.#projectId,
        employeeId: assignment.#employeeId,
        organizationId: assignment.#organizationId,
      }),
    );
    return assignment;
  }

  /** The assignment id. */
  get id(): AssignmentId {
    return this.#id;
  }

  /** The project the employee is assigned to. */
  get projectId(): ProjectId {
    return this.#projectId;
  }

  /** The employee id (HR bounded context reference). */
  get employeeId(): string {
    return this.#employeeId;
  }

  /** The owning organization (tenant) id — immutable. */
  get organizationId(): TenantId {
    return this.#organizationId;
  }

  /** ISO-8601 UTC assignment time. */
  get assignedAt(): string {
    return this.#assignedAt;
  }

  /** Monotonic version for optimistic concurrency (EntityMeta). */
  get version(): number {
    return this.#version;
  }

  /**
   * Produces a persistence snapshot of the assignment (PERSISTENCE.md §4
   * aggregate ownership).
   */
  static snapshot(assignment: ResourceAssignment): ResourceAssignmentSnapshot {
    return {
      id: assignment.id,
      projectId: assignment.projectId,
      employeeId: assignment.employeeId,
      organizationId: assignment.organizationId,
      assignedAt: assignment.assignedAt,
      version: assignment.version,
    };
  }

  /**
   * Reconstructs a {@link ResourceAssignment} from a persistence snapshot
   * without emitting domain events (DDD reconstitution factory).
   */
  static hydrate(snapshot: ResourceAssignmentSnapshot): ResourceAssignment {
    const assignment = new ResourceAssignment(
      {
        projectId: snapshot.projectId,
        employeeId: snapshot.employeeId,
        organizationId: snapshot.organizationId,
      },
      snapshot.assignedAt,
    );
    assignment.#id = snapshot.id;
    assignment.#version = snapshot.version;
    return assignment;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }
}
