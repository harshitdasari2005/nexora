/**
 * @nexora/application-projects — ProjectApplicationService.
 *
 * The application layer orchestrator (BACKEND.md §4): it coordinates the
 * projects domain services (lifecycle + resource assignment), collects
 * emitted domain events, and publishes them through the {@link EventPublisher}
 * port. It contains no business rules of its own — every invariant is
 * enforced by the domain.
 *
 * Cross-bounded-context composition (employee resolution, permission checks)
 * happens at the orchestration boundary — the AI tool and HTTP adapter —
 * never inside this service. The employee arrives here as a trusted id.
 */

import type { TenantId } from '@nexora/contracts/common';
import type { EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import type {
  ProjectDomainService,
  ProjectEventContext,
  ResourceAssignmentDomainService,
} from '@nexora/domain-projects';
import { ProjectId } from '@nexora/domain-projects';

import type {
  CreateProjectCommand,
  CreateProjectResult,
} from '../commands/create-project.command.js';
import type {
  AssignEmployeeToProjectCommand,
  AssignEmployeeToProjectResult,
} from '../commands/assign-employee.command.js';
import { toProjectDto, type ProjectDto } from '../dto/project.dto.js';
import { toProjectMemberDto, type ProjectMemberDto } from '../dto/project-member.dto.js';
import { validateCreateProject } from '../validators/create-project.validator.js';

/** Dependencies of the {@link ProjectApplicationService}. */
export interface ProjectApplicationServiceDependencies {
  /** The project lifecycle domain service. */
  projectsService: ProjectDomainService;
  /** The resource-assignment domain service (employee → project). */
  assignmentsService: ResourceAssignmentDomainService;
  /** Publishes domain events to the platform event stream. */
  publisher: EventPublisher;
}

/**
 * The projects application service. All methods return a `Result` so
 * expected failures are explicit values.
 */
export class ProjectApplicationService {
  readonly #projectsService: ProjectDomainService;
  readonly #assignmentsService: ResourceAssignmentDomainService;
  readonly #publisher: EventPublisher;

  constructor(dependencies: ProjectApplicationServiceDependencies) {
    this.#projectsService = dependencies.projectsService;
    this.#assignmentsService = dependencies.assignmentsService;
    this.#publisher = dependencies.publisher;
  }

  /**
   * Creates a project: draft the charter (`proposed`) and, in v1, activate
   * it (`active` — the creating owner approves the charter; the WRK-4
   * approval-chain workflow is a later sprint). Emitted events are
   * published once, after the whole sequence succeeds.
   */
  async createProject(
    command: CreateProjectCommand,
  ): Promise<Result<CreateProjectResult, NexoraError>> {
    try {
      validateCreateProject(command);
      const context = projectContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
      );

      const created = await this.#projectsService.create(
        {
          organizationId: command.organizationId,
          name: command.name,
          description: command.description,
        },
        context,
      );
      if (!created.ok) {
        return err(created.error);
      }

      const activated = await this.#projectsService.activate(created.value.project.id, context);
      if (!activated.ok) {
        return err(activated.error);
      }

      const events = [...created.value.events, ...activated.value.events];
      await this.#publisher.publish(events);

      return ok({
        project: activated.value.project,
        events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected project application error'));
    }
  }

  /**
   * Assigns a resolved employee to a project. The project must exist, belong
   * to the trusted organization, be in an assignable lifecycle state
   * (`active`), and the employee must not already be assigned — all enforced
   * by the domain service before any state exists. Emitted events are
   * published once.
   */
  async assignEmployeeToProject(
    command: AssignEmployeeToProjectCommand,
  ): Promise<Result<AssignEmployeeToProjectResult, NexoraError>> {
    try {
      const projectId = ProjectId.from(command.projectId);
      const context = projectContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
      );

      const assigned = await this.#assignmentsService.assign(
        { projectId, employeeId: command.employeeId },
        context,
      );
      if (!assigned.ok) {
        return err(assigned.error);
      }

      await this.#publisher.publish(assigned.value.events);

      return ok({
        assignment: assigned.value.assignment,
        events: assigned.value.events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected project assignment error'));
    }
  }

  /**
   * Lists the projects of an organization, mapped to DTOs. The organization
   * is the trusted tenant scope — the AI and HTTP surfaces both call this
   * same path (one business execution path).
   */
  async listProjectsByOrganization(
    organizationId: TenantId,
  ): Promise<Result<readonly ProjectDto[], never>> {
    const listed = await this.#projectsService.listByOrganization(organizationId);
    if (!listed.ok) {
      return err(listed.error);
    }
    return ok(listed.value.map((project) => toProjectDto(project)));
  }

  /**
   * Resolves projects by name within an organization (tenant-scoped,
   * case-insensitive substring). Returns every candidate — the caller
   * distinguishes resolved (exactly one) from ambiguous (multiple).
   */
  async findProjectByName(
    organizationId: TenantId,
    name: string,
  ): Promise<Result<readonly ProjectDto[], never>> {
    const found = await this.#projectsService.findByName(organizationId, name);
    if (!found.ok) {
      return err(found.error);
    }
    return ok(found.value.map((project) => toProjectDto(project)));
  }

  /**
   * Lists the members (assignments) of a project. Tenant-scoped: the project
   * must belong to the trusted organization, otherwise no members are
   * returned (defense in depth — the id alone grants nothing).
   */
  async listProjectMembers(
    organizationId: TenantId,
    projectId: string,
  ): Promise<Result<readonly ProjectMemberDto[], NexoraError>> {
    try {
      const id = ProjectId.from(projectId);
      const project = await this.#projectsService.findById(id);
      if (!project.ok) {
        return ok([]);
      }
      if (project.value.organizationId !== organizationId) {
        // Tenant isolation: a foreign project id resolves to an empty member
        // list, never to foreign assignments.
        return ok([]);
      }
      const members = await this.#assignmentsService.listByProject(id);
      if (!members.ok) {
        return err(members.error);
      }
      return ok(members.value.map((assignment) => toProjectMemberDto(assignment)));
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected project member query error'));
    }
  }
}

/** Builds a projects event context (tenant known to caller). */
function projectContext(
  actorId: string,
  correlationId: string,
  organizationId: TenantId,
): ProjectEventContext {
  return { actor: { kind: 'user', id: actorId }, correlationId, organizationId };
}
