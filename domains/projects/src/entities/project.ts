/**
 * @nexora/domain-projects — Project aggregate root.
 *
 * The central aggregate of the Projects bounded context (DOMAIN_MODEL.md
 * §14.2 Projects): a unit of work owned by exactly one organization (the
 * `organizationId`, immutable) with a name, an optional description, and a
 * lifecycle (`proposed → active → on_hold ⇄ active → completed →
 * archived`; `cancelled` from proposed/active). All state changes flow
 * through aggregate methods, which enforce business invariants and record
 * domain events. No partial aggregate mutation on validation failure:
 * transitions validate the policy FIRST, then mutate, then emit the event.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId } from '@nexora/contracts/common';

import type { ProjectEventContext } from '../events/index.js';
import {
  projectActivatedEvent,
  projectArchivedEvent,
  projectCancelledEvent,
  projectCompletedEvent,
  projectCreatedEvent,
  projectOnHoldEvent,
  projectResumedEvent,
} from '../events/index.js';
import { ProjectStateTransitionError } from '../errors/index.js';
import { PROJECT_TRANSITIONS } from '../policies/index.js';
import type { ProjectId } from '../value-objects/project-id.js';
import { ProjectId as ProjectIdFactory } from '../value-objects/project-id.js';
import { ProjectName } from '../value-objects/project-name.js';
import { ProjectDescription } from '../value-objects/project-description.js';
import { ProjectStatus } from '../value-objects/project-status.js';

/** Input for creating a new {@link Project}. */
export interface CreateProjectInput {
  /** The owning organization (tenant) id — immutable. */
  organizationId: TenantId;
  /** The project name (validated). */
  name: string;
  /** Optional short description. */
  description?: string;
}

/**
 * A persistence snapshot of the {@link Project} aggregate (PERSISTENCE.md
 * §4 aggregate ownership). Plain data produced by {@link Project.snapshot}
 * and consumed by {@link Project.hydrate} — no behavior.
 */
export interface ProjectSnapshot {
  /** The project id. */
  id: ProjectId;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The project name. */
  name: string;
  /** The optional description, when present. */
  description?: string;
  /** The lifecycle status value. */
  status: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link Project} aggregate root. Use {@link Project.create} to
 * construct; mutate only through aggregate methods so invariants stay
 * protected.
 */
export class Project {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: ProjectId;
  readonly #organizationId: TenantId;
  readonly #name: ProjectName;
  readonly #description: ProjectDescription;
  #status: ProjectStatus;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateProjectInput, createdAt: string) {
    this.#id = ProjectIdFactory.create();
    this.#organizationId = input.organizationId;
    this.#name = ProjectName.create(input.name);
    this.#description = ProjectDescription.create(input.description);
    this.#status = ProjectStatus.proposed();
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link Project} in `proposed` status (the charter is
   * drafted, awaiting approval per WRK-4) and records a
   * {@link projectCreatedEvent}.
   *
   * @param input   - creation data (organization id, name, optional description).
   * @param context - event context (actor, correlation id, organization id).
   * @param now     - ISO-8601 UTC creation time (defaults to now).
   */
  static create(input: CreateProjectInput, context: ProjectEventContext, now = nowIso()): Project {
    const project = new Project(input, now);
    project.#events.push(
      projectCreatedEvent(context, project.#id, {
        projectId: project.#id,
        name: project.#name.value,
        organizationId: project.#organizationId,
        status: project.#status.value,
      }),
    );
    return project;
  }

  /** The project id. */
  get id(): ProjectId {
    return this.#id;
  }

  /** The owning organization (tenant) id — immutable (exactly one org). */
  get organizationId(): TenantId {
    return this.#organizationId;
  }

  /** The project name. */
  get name(): ProjectName {
    return this.#name;
  }

  /** The optional description. */
  get description(): ProjectDescription {
    return this.#description;
  }

  /** The lifecycle status. */
  get status(): ProjectStatus {
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

  /** Whether the project is actively being executed. */
  isActive(): boolean {
    return this.#status.isActive();
  }

  /**
   * Activates the project (`proposed` → `active` — charter approved, WRK-4)
   * and records a {@link projectActivatedEvent}.
   *
   * @throws {ProjectStateTransitionError} when the transition is not allowed.
   */
  activate(context: ProjectEventContext, now = nowIso()): void {
    this.#transitionTo(ProjectStatus.active(), 'activate', now);
    this.#events.push(projectActivatedEvent(context, this.#id));
  }

  /**
   * Pauses the project (`active` → `on_hold` — authorized pause) and records
   * a {@link projectOnHoldEvent}.
   *
   * @param reason - why the project is being paused.
   * @throws {ProjectStateTransitionError} when the transition is not allowed.
   */
  hold(reason: string, context: ProjectEventContext, now = nowIso()): void {
    this.#transitionTo(ProjectStatus.onHold(), 'hold', now);
    this.#events.push(projectOnHoldEvent(context, this.#id, reason));
  }

  /**
   * Resumes the project (`on_hold` → `active`) and records a
   * {@link projectResumedEvent}.
   *
   * @throws {ProjectStateTransitionError} when the transition is not allowed.
   */
  resume(context: ProjectEventContext, now = nowIso()): void {
    this.#transitionTo(ProjectStatus.active(), 'resume', now);
    this.#events.push(projectResumedEvent(context, this.#id));
  }

  /**
   * Completes the project (`active` → `completed` — owner closes, EVT-9)
   * and records a {@link projectCompletedEvent}.
   *
   * @throws {ProjectStateTransitionError} when the transition is not allowed.
   */
  complete(context: ProjectEventContext, now = nowIso()): void {
    this.#transitionTo(ProjectStatus.completed(), 'complete', now);
    this.#events.push(projectCompletedEvent(context, this.#id));
  }

  /**
   * Archives the project (`completed` → `archived` — retention policy) and
   * records a {@link projectArchivedEvent}. Archived is terminal in v1: the
   * project is immutable and retains data and audit.
   *
   * @param reason - why the project is being archived.
   * @throws {ProjectStateTransitionError} when the transition is not allowed.
   */
  archive(reason: string, context: ProjectEventContext, now = nowIso()): void {
    this.#transitionTo(ProjectStatus.archived(), 'archive', now);
    this.#events.push(projectArchivedEvent(context, this.#id, reason));
  }

  /**
   * Cancels the project (`proposed`/`active` → `cancelled` — owner +
   * approval) and records a {@link projectCancelledEvent}. Cancelled is
   * terminal in v1.
   *
   * @param reason - why the project is being cancelled.
   * @throws {ProjectStateTransitionError} when the transition is not allowed.
   */
  cancel(reason: string, context: ProjectEventContext, now = nowIso()): void {
    this.#transitionTo(ProjectStatus.cancelled(), 'cancel', now);
    this.#events.push(projectCancelledEvent(context, this.#id, reason));
  }

  /**
   * Produces a persistence snapshot of the project (PERSISTENCE.md §4
   * aggregate ownership).
   */
  static snapshot(project: Project): ProjectSnapshot {
    return {
      id: project.id,
      organizationId: project.organizationId,
      name: project.name.value,
      description: project.description.value,
      status: project.status.value,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      version: project.version,
    };
  }

  /**
   * Reconstructs a {@link Project} from a persistence snapshot without
   * emitting domain events (DDD reconstitution factory). Reuses the id from
   * the snapshot; values are re-validated through the value-object
   * factories at load.
   */
  static hydrate(snapshot: ProjectSnapshot): Project {
    const project = new Project(
      {
        organizationId: snapshot.organizationId,
        name: snapshot.name,
        description: snapshot.description,
      },
      snapshot.createdAt,
    );
    project.#id = snapshot.id;
    project.#status = ProjectStatus.from(snapshot.status);
    project.#updatedAt = snapshot.updatedAt;
    project.#version = snapshot.version;
    return project;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Enforces the project lifecycle transition table (validate → mutate → event). */
  #transitionTo(target: ProjectStatus, action: string, now: string): void {
    const allowed = PROJECT_TRANSITIONS[this.#status.value];
    if (!allowed.includes(target.value)) {
      throw new ProjectStateTransitionError(
        `Cannot ${action} a project in status ${this.#status.value}`,
        { projectId: this.#id, from: this.#status.value, to: target.value },
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
