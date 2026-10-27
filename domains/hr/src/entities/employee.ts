/**
 * @nexora/domain-hr — Employee aggregate root.
 *
 * The central aggregate of the HR bounded context (DOMAIN_MODEL.md §14.1):
 * a person record owned by exactly one organization (the `organizationId`,
 * immutable) with a name and an employment lifecycle (`proposed → hired →
 * onboarding → active ⇄ on_leave → exiting → offboarded`; `cancelled` from
 * proposed). All state changes flow through aggregate methods, which enforce
 * business invariants and record domain events. No partial aggregate mutation
 * on validation failure: transitions validate the policy FIRST, then mutate,
 * then emit the event.
 *
 * Only active employees are assignable to work (BR-16) — the Projects
 * ResourceAssignment aggregate and the AssignEmployeeToProject capability
 * both enforce this invariant at their boundaries.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId } from '@nexora/contracts/common';

import type { EmployeeEventContext } from '../events/index.js';
import {
  employeeActivatedEvent,
  employeeCreatedEvent,
  employeeOffboardedEvent,
} from '../events/index.js';
import { EmployeeStateTransitionError } from '../errors/index.js';
import { EMPLOYEE_TRANSITIONS } from '../policies/index.js';
import type { EmployeeId } from '../value-objects/employee-id.js';
import { EmployeeId as EmployeeIdFactory } from '../value-objects/employee-id.js';
import { EmployeeName } from '../value-objects/employee-name.js';
import { EmployeeStatus } from '../value-objects/employee-status.js';

/** Input for creating a new {@link Employee}. */
export interface CreateEmployeeInput {
  /** The owning organization (tenant) id — immutable. */
  organizationId: TenantId;
  /** The employee name (validated). */
  name: string;
  /** The employment details known at hire (absent for legacy name-only records). */
  profile?: EmployeeProfile;
}

/**
 * What the organization knows about the employment itself, captured when a
 * person is hired through recruiting. Every field is optional: records created
 * before recruiting existed carry a name only.
 */
export interface EmployeeProfile {
  /** Work/contact email. */
  email?: string;
  jobTitle?: string;
  /** The team / department. */
  department?: string;
  /** `full_time` | `part_time` | `contract` | `intern`. */
  employmentType?: string;
  /** The agreed start date (`YYYY-MM-DD`). */
  startDate?: string;
  /** The hiring request this hire fulfils. */
  requisitionId?: string;
}

/** Trims a profile and drops empty fields (so an empty profile is no profile). */
function normalizeProfile(profile: EmployeeProfile | undefined): EmployeeProfile | undefined {
  if (profile === undefined) return undefined;
  const normalized: EmployeeProfile = {};
  for (const key of [
    'email',
    'jobTitle',
    'department',
    'employmentType',
    'startDate',
    'requisitionId',
  ] as const) {
    const value = profile[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      normalized[key] = value.trim();
    }
  }
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

/**
 * A persistence snapshot of the {@link Employee} aggregate (PERSISTENCE.md
 * §4 aggregate ownership). Plain data produced by {@link Employee.snapshot}
 * and consumed by {@link Employee.hydrate} — no behavior.
 */
export interface EmployeeSnapshot {
  /** The employee id. */
  id: EmployeeId;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The employee name. */
  name: string;
  /** The employment status value. */
  status: string;
  /** The employment details, when known. */
  profile?: EmployeeProfile;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link Employee} aggregate root. Use {@link Employee.create} to
 * construct; mutate only through aggregate methods so invariants stay
 * protected.
 */
export class Employee {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: EmployeeId;
  readonly #organizationId: TenantId;
  readonly #name: EmployeeName;
  readonly #profile: EmployeeProfile | undefined;
  #status: EmployeeStatus;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateEmployeeInput, createdAt: string) {
    this.#id = EmployeeIdFactory.create();
    this.#organizationId = input.organizationId;
    this.#name = EmployeeName.create(input.name);
    this.#profile = normalizeProfile(input.profile);
    this.#status = EmployeeStatus.proposed();
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link Employee} in `proposed` status (the hire record
   * exists, EVT-1) and records an {@link employeeCreatedEvent}.
   *
   * @param input   - creation data (organization id, name).
   * @param context - event context (actor, correlation id, organization id).
   * @param now     - ISO-8601 UTC creation time (defaults to now).
   */
  static create(
    input: CreateEmployeeInput,
    context: EmployeeEventContext,
    now = nowIso(),
  ): Employee {
    const employee = new Employee(input, now);
    employee.#events.push(
      employeeCreatedEvent(context, employee.#id, {
        employeeId: employee.#id,
        name: employee.#name.value,
        organizationId: employee.#organizationId,
        status: employee.#status.value,
      }),
    );
    return employee;
  }

  /** The employee id. */
  get id(): EmployeeId {
    return this.#id;
  }

  /** The owning organization (tenant) id — immutable (exactly one org). */
  get organizationId(): TenantId {
    return this.#organizationId;
  }

  /** The employee name. */
  get name(): EmployeeName {
    return this.#name;
  }

  /** The employment details, when known (a copy). */
  get profile(): EmployeeProfile | undefined {
    return this.#profile === undefined ? undefined : { ...this.#profile };
  }

  /** The employment status. */
  get status(): EmployeeStatus {
    return this.#status;
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time of the last mutation. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version for optimistic concurrency (EntityMeta). */
  get version(): number {
    return this.#version;
  }

  /** Whether the employee is active and assignable (BR-16). */
  isActive(): boolean {
    return this.#status.isActive();
  }

  /**
   * Hires the employee (`proposed` → `hired` — offer accepted, EVT-1).
   *
   * @throws {EmployeeStateTransitionError} when the transition is not allowed.
   */
  hire(context: EmployeeEventContext, now = nowIso()): void {
    this.#transitionTo(EmployeeStatus.hired(), 'hire', now);
  }

  /**
   * Starts onboarding (`hired` → `onboarding` — WRK-2).
   *
   * @throws {EmployeeStateTransitionError} when the transition is not allowed.
   */
  onboard(context: EmployeeEventContext, now = nowIso()): void {
    this.#transitionTo(EmployeeStatus.onboarding(), 'onboard', now);
  }

  /**
   * Activates the employee (`onboarding` → `active` — checklist complete,
   * EVT-3) and records an {@link employeeActivatedEvent}. Active employees
   * are assignable (BR-16).
   *
   * @throws {EmployeeStateTransitionError} when the transition is not allowed.
   */
  activate(context: EmployeeEventContext, now = nowIso()): void {
    this.#transitionTo(EmployeeStatus.active(), 'activate', now);
    this.#events.push(employeeActivatedEvent(context, this.#id));
  }

  /**
   * Cancels the employee (`proposed` → `cancelled` — offer declined, EVT-1).
   * Cancelled is terminal in v1.
   *
   * @throws {EmployeeStateTransitionError} when the transition is not allowed.
   */
  cancel(context: EmployeeEventContext, now = nowIso()): void {
    this.#transitionTo(EmployeeStatus.cancelled(), 'cancel', now);
  }

  /**
   * Starts offboarding (`active | on_leave` → `exiting` — WRK-3).
   *
   * @throws {EmployeeStateTransitionError} when the transition is not allowed.
   */
  startOffboarding(context: EmployeeEventContext, now = nowIso()): void {
    this.#transitionTo(EmployeeStatus.exiting(), 'start offboarding', now);
  }

  /**
   * Completes offboarding (`exiting` → `offboarded` — EVT-4). Offboarded is
   * terminal: the record is retained (audit history), the employee is no
   * longer active or assignable (BR-16).
   *
   * @param reason - why the employment ended (recorded on the event).
   * @throws {EmployeeStateTransitionError} when the transition is not allowed.
   */
  offboard(context: EmployeeEventContext, reason: string, now = nowIso()): void {
    this.#transitionTo(EmployeeStatus.offboarded(), 'offboard', now);
    this.#events.push(employeeOffboardedEvent(context, this.#id, reason));
  }

  /**
   * Produces a persistence snapshot of the employee (PERSISTENCE.md §4
   * aggregate ownership).
   */
  static snapshot(employee: Employee): EmployeeSnapshot {
    return {
      id: employee.id,
      organizationId: employee.organizationId,
      name: employee.name.value,
      status: employee.status.value,
      ...(employee.profile === undefined ? {} : { profile: employee.profile }),
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
      version: employee.version,
    };
  }

  /**
   * Reconstructs an {@link Employee} from a persistence snapshot without
   * emitting domain events (DDD reconstitution factory). Reuses the id from
   * the snapshot; values are re-validated through the value-object factories
   * at load.
   */
  static hydrate(snapshot: EmployeeSnapshot): Employee {
    const employee = new Employee(
      {
        organizationId: snapshot.organizationId,
        name: snapshot.name,
        ...(snapshot.profile === undefined ? {} : { profile: snapshot.profile }),
      },
      snapshot.createdAt,
    );
    employee.#id = snapshot.id;
    employee.#status = EmployeeStatus.from(snapshot.status);
    employee.#updatedAt = snapshot.updatedAt;
    employee.#version = snapshot.version;
    return employee;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Enforces the employee lifecycle transition table (validate → mutate → event). */
  #transitionTo(target: EmployeeStatus, action: string, now: string): void {
    const allowed = EMPLOYEE_TRANSITIONS[this.#status.value];
    if (!allowed.includes(target.value)) {
      throw new EmployeeStateTransitionError(
        `Cannot ${action} an employee in status ${this.#status.value}`,
        { employeeId: this.#id, from: this.#status.value, to: target.value },
      );
    }
    // Validate → mutate: the transition is legal, then mutate and record.
    this.#status = target;
    this.#bump(now);
  }

  /** Bumps the version and updated-at timestamp (optimistic concurrency). */
  #bump(now = nowIso()): void {
    this.#version += 1;
    this.#updatedAt = now;
  }
}
