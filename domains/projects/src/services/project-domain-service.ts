/**
 * @nexora/domain-projects — ProjectDomainService.
 *
 * Orchestrates the {@link Project} aggregate lifecycle (DOMAIN_MODEL.md
 * §14.2): creation, activation, hold, resume, completion, archival, and
 * cancellation. Owns the use-case workflows that span the aggregate and its
 * repository; the aggregate enforces its own invariants. All methods return
 * a `Result` so expected failures are explicit values, not exceptions.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';
import type { TenantId } from '@nexora/contracts/common';

import { Project } from '../entities/project.js';
import type { ProjectEventContext } from '../events/index.js';
import {
  ProjectNotFoundError,
  toProjectError,
  type InvalidProjectValueError,
  type ProjectStateTransitionError,
} from '../errors/index.js';
import { ProjectLifecyclePolicy, ProjectValuePolicy } from '../policies/index.js';
import type { ProjectRepository } from '../repositories/index.js';
import type { ProjectId } from '../value-objects/project-id.js';
import { ProjectStatus } from '../value-objects/project-status.js';

/** Input for creating a project. */
export interface CreateProjectCommand {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The project name. */
  name: string;
  /** Optional short description. */
  description?: string;
}

/** The outcome of a project command: the aggregate plus emitted events. */
export interface ProjectCommandResult {
  /** The mutated aggregate. */
  project: Project;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link ProjectDomainService}. */
export interface ProjectDomainServiceDependencies {
  /** Project persistence. */
  projects: ProjectRepository;
  /** Lifecycle policy (status transitions). */
  lifecycle?: ProjectLifecyclePolicy;
}

/**
 * The project lifecycle use-case service.
 */
export class ProjectDomainService {
  readonly #projects: ProjectRepository;
  readonly #lifecycle: ProjectLifecyclePolicy;
  readonly #values: ProjectValuePolicy;

  constructor(dependencies: ProjectDomainServiceDependencies) {
    this.#projects = dependencies.projects;
    this.#lifecycle = dependencies.lifecycle ?? new ProjectLifecyclePolicy();
    this.#values = new ProjectValuePolicy();
  }

  /**
   * Creates a project: validates the input through the aggregate factory,
   * persists it in `proposed`, and returns the aggregate plus its events.
   */
  async create(
    input: CreateProjectCommand,
    context: ProjectEventContext,
  ): Promise<Result<ProjectCommandResult, InvalidProjectValueError>> {
    try {
      // Policy pre-check (fail fast before any state exists) — the aggregate
      // factory re-validates through the value-object constructors, so this
      // is defense-in-depth, not the single enforcement point.
      this.#values.assertValidName(input.name);
      this.#values.assertValidDescription(input.description);
      // The aggregate factory validates name/description BEFORE any state
      // exists — a validation failure produces no aggregate and no mutation.
      const project = Project.create(
        {
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
        },
        context,
      );
      await this.#projects.save(project);
      return ok({ project, events: project.pullDomainEvents() });
    } catch (error) {
      return err(toProjectError(error) as InvalidProjectValueError);
    }
  }

  /** Activates a project (`proposed` → `active` — charter approved, WRK-4). */
  async activate(
    projectId: ProjectId,
    context: ProjectEventContext,
  ): Promise<Result<ProjectCommandResult, ProjectNotFoundError | ProjectStateTransitionError>> {
    try {
      const project = await this.#requireProject(projectId);
      this.#lifecycle.assertCanTransition(project.status, ProjectStatus.active());
      project.activate(context);
      await this.#projects.save(project);
      return ok({ project, events: project.pullDomainEvents() });
    } catch (error) {
      return err(toProjectError(error) as ProjectNotFoundError | ProjectStateTransitionError);
    }
  }

  /** Pauses a project (`active` → `on_hold` — authorized pause). */
  async hold(
    projectId: ProjectId,
    reason: string,
    context: ProjectEventContext,
  ): Promise<Result<ProjectCommandResult, ProjectNotFoundError | ProjectStateTransitionError>> {
    try {
      const project = await this.#requireProject(projectId);
      this.#lifecycle.assertCanTransition(project.status, ProjectStatus.onHold());
      project.hold(reason, context);
      await this.#projects.save(project);
      return ok({ project, events: project.pullDomainEvents() });
    } catch (error) {
      return err(toProjectError(error) as ProjectNotFoundError | ProjectStateTransitionError);
    }
  }

  /** Resumes a project (`on_hold` → `active`). */
  async resume(
    projectId: ProjectId,
    context: ProjectEventContext,
  ): Promise<Result<ProjectCommandResult, ProjectNotFoundError | ProjectStateTransitionError>> {
    try {
      const project = await this.#requireProject(projectId);
      this.#lifecycle.assertCanTransition(project.status, ProjectStatus.active());
      project.resume(context);
      await this.#projects.save(project);
      return ok({ project, events: project.pullDomainEvents() });
    } catch (error) {
      return err(toProjectError(error) as ProjectNotFoundError | ProjectStateTransitionError);
    }
  }

  /** Completes a project (`active` → `completed` — owner closes, EVT-9). */
  async complete(
    projectId: ProjectId,
    context: ProjectEventContext,
  ): Promise<Result<ProjectCommandResult, ProjectNotFoundError | ProjectStateTransitionError>> {
    try {
      const project = await this.#requireProject(projectId);
      this.#lifecycle.assertCanTransition(project.status, ProjectStatus.completed());
      project.complete(context);
      await this.#projects.save(project);
      return ok({ project, events: project.pullDomainEvents() });
    } catch (error) {
      return err(toProjectError(error) as ProjectNotFoundError | ProjectStateTransitionError);
    }
  }

  /** Archives a project (`completed` → `archived` — retention policy). */
  async archive(
    projectId: ProjectId,
    reason: string,
    context: ProjectEventContext,
  ): Promise<Result<ProjectCommandResult, ProjectNotFoundError | ProjectStateTransitionError>> {
    try {
      const project = await this.#requireProject(projectId);
      this.#lifecycle.assertCanTransition(project.status, ProjectStatus.archived());
      project.archive(reason, context);
      await this.#projects.save(project);
      return ok({ project, events: project.pullDomainEvents() });
    } catch (error) {
      return err(toProjectError(error) as ProjectNotFoundError | ProjectStateTransitionError);
    }
  }

  /** Cancels a project (`proposed`/`active` → `cancelled`). */
  async cancel(
    projectId: ProjectId,
    reason: string,
    context: ProjectEventContext,
  ): Promise<Result<ProjectCommandResult, ProjectNotFoundError | ProjectStateTransitionError>> {
    try {
      const project = await this.#requireProject(projectId);
      this.#lifecycle.assertCanTransition(project.status, ProjectStatus.cancelled());
      project.cancel(reason, context);
      await this.#projects.save(project);
      return ok({ project, events: project.pullDomainEvents() });
    } catch (error) {
      return err(toProjectError(error) as ProjectNotFoundError | ProjectStateTransitionError);
    }
  }

  /** Finds a project by id, or returns a {@link ProjectNotFoundError}. */
  async findById(projectId: ProjectId): Promise<Result<Project, ProjectNotFoundError>> {
    const project = await this.#projects.findById(projectId);
    if (project === undefined) {
      return err(new ProjectNotFoundError({ projectId }));
    }
    return ok(project);
  }

  /** Lists the projects of an organization (tenant-scoped read). */
  async listByOrganization(organizationId: TenantId): Promise<Result<readonly Project[], never>> {
    return ok(await this.#projects.listByOrganization(organizationId));
  }

  /**
   * Resolves projects by name within an organization (tenant-scoped,
   * case-insensitive substring). Returns every candidate — the caller
   * decides between resolved (exactly one) and ambiguous (multiple) so no
   * guess is ever made (AI resolution contract).
   */
  async findByName(
    organizationId: TenantId,
    name: string,
  ): Promise<Result<readonly Project[], never>> {
    return ok(await this.#projects.findByName(organizationId, name));
  }

  /** Loads a project or throws {@link ProjectNotFoundError}. */
  async #requireProject(projectId: ProjectId): Promise<Project> {
    const project = await this.#projects.findById(projectId);
    if (project === undefined) {
      throw new ProjectNotFoundError({ projectId });
    }
    return project;
  }
}
