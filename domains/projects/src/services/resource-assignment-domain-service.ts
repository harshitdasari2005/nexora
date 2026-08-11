/**
 * @nexora/domain-projects — ResourceAssignmentDomainService.
 *
 * Orchestrates the {@link ResourceAssignment} use case (DOMAIN_MODEL.md
 * §14.2 Projects `assign_resource`): assign an employee to a project. The
 * service coordinates the Projects aggregates it owns — it loads the Project
 * (to enforce the assignable-lifecycle invariant and the tenant scope) and
 * consults the assignment repository (duplicate-assignment protection). The
 * employee is referenced by id only (AP-13); its existence is validated at
 * the application/orchestration boundary by the HR bounded context.
 *
 * All methods return a `Result` so expected failures are explicit values.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';

import { ResourceAssignment } from '../entities/resource-assignment.js';
import type { ProjectEventContext } from '../events/index.js';
import {
  DuplicateAssignmentError,
  ProjectNotAssignableError,
  ProjectNotFoundError,
  toProjectError,
} from '../errors/index.js';
import type { ProjectRepository, ResourceAssignmentRepository } from '../repositories/index.js';
import type { ProjectId } from '../value-objects/project-id.js';

/** Input for assigning an employee to a project. */
export interface AssignResourceCommand {
  /** The project the employee is assigned to. */
  projectId: ProjectId;
  /** The employee id (resolved by the HR bounded context). */
  employeeId: string;
}

/** The outcome of a successful assignment: the aggregate plus its events. */
export interface ResourceAssignmentResult {
  /** The created assignment. */
  assignment: ResourceAssignment;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link ResourceAssignmentDomainService}. */
export interface ResourceAssignmentDomainServiceDependencies {
  /** Project persistence (assignable-lifecycle + tenant-scope checks). */
  projects: ProjectRepository;
  /** Assignment persistence (duplicate protection). */
  assignments: ResourceAssignmentRepository;
}

/**
 * The project-assignment use-case service.
 */
export class ResourceAssignmentDomainService {
  readonly #projects: ProjectRepository;
  readonly #assignments: ResourceAssignmentRepository;

  constructor(dependencies: ResourceAssignmentDomainServiceDependencies) {
    this.#projects = dependencies.projects;
    this.#assignments = dependencies.assignments;
  }

  /**
   * Assigns an employee to a project. Enforces, in order:
   * 1. the project exists (or {@link ProjectNotFoundError});
   * 2. the project belongs to the caller's tenant (organization scope);
   * 3. the project is in an assignable lifecycle state (`active`);
   * 4. the employee is not already assigned (or {@link DuplicateAssignmentError}).
   *
   * All checks run BEFORE any state exists — a failed check produces no
   * aggregate and no mutation.
   */
  async assign(
    input: AssignResourceCommand,
    context: ProjectEventContext,
  ): Promise<
    Result<
      ResourceAssignmentResult,
      ProjectNotFoundError | ProjectNotAssignableError | DuplicateAssignmentError
    >
  > {
    try {
      // 1–3. Validate the project (exists, tenant scope, assignable state).
      const project = await this.#projects.findById(input.projectId);
      if (project === undefined) {
        return err(new ProjectNotFoundError({ projectId: input.projectId }));
      }
      if (project.organizationId !== context.organizationId) {
        // Tenant isolation: an assignment can never cross the tenant boundary
        // even if the caller could reach the project id (defense in depth).
        return err(new ProjectNotFoundError({ projectId: input.projectId }));
      }
      if (!project.isActive()) {
        return err(
          new ProjectNotAssignableError({
            projectId: input.projectId,
            status: project.status.value,
          }),
        );
      }

      // 4. Duplicate-assignment protection: one active assignment per pair.
      const existing = await this.#assignments.findByProjectAndEmployee(
        input.projectId,
        input.employeeId,
      );
      if (existing !== undefined) {
        return err(
          new DuplicateAssignmentError({
            projectId: input.projectId,
            employeeId: input.employeeId,
          }),
        );
      }

      // Validate → mutate → event: create (no partial mutation) and persist.
      const assignment = ResourceAssignment.create(
        {
          projectId: input.projectId,
          employeeId: input.employeeId,
          organizationId: context.organizationId,
        },
        context,
      );
      await this.#assignments.save(assignment);
      return ok({ assignment, events: assignment.pullDomainEvents() });
    } catch (error) {
      return err(
        toProjectError(error) as
          ProjectNotFoundError | ProjectNotAssignableError | DuplicateAssignmentError,
      );
    }
  }

  /** Lists the members (assignments) of a project. */
  async listByProject(projectId: ProjectId): Promise<Result<readonly ResourceAssignment[], never>> {
    return ok(await this.#assignments.listByProject(projectId));
  }
}
