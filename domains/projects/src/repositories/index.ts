/**
 * @nexora/domain-projects — repository interfaces.
 *
 * The persistence ports of the Projects bounded context (BACKEND.md §2
 * dependency direction; PERSISTENCE.md §4 aggregate ownership). The domain
 * depends on these interfaces; the infrastructure layer (PostgreSQL/Drizzle)
 * implements them. No ORM, no SQL, no persistence here.
 */

import type { TenantId } from '@nexora/contracts/common';

import type { Project } from '../entities/project.js';
import type { ResourceAssignment } from '../entities/resource-assignment.js';
import type { AssignmentId } from '../value-objects/assignment-id.js';
import type { ProjectId } from '../value-objects/project-id.js';

/**
 * The persistence port of the {@link Project} aggregate.
 */
export interface ProjectRepository {
  /** Loads a project by id, or `undefined` when it does not exist. */
  findById(id: ProjectId): Promise<Project | undefined>;

  /** Lists the projects of an organization (tenant-scoped read). */
  listByOrganization(organizationId: TenantId): Promise<readonly Project[]>;

  /**
   * Finds projects whose name matches the given term within an organization
   * (tenant-scoped, case-insensitive substring match). Used by the
   * deterministic name resolution used by the AI tooling (no guessing).
   */
  findByName(organizationId: TenantId, name: string): Promise<readonly Project[]>;

  /** Persists the aggregate (insert or update by id). */
  save(project: Project): Promise<void>;
}

/**
 * The persistence port of the {@link ResourceAssignment} aggregate.
 */
export interface ResourceAssignmentRepository {
  /**
   * Loads the active assignment of an employee to a project, or `undefined`
   * when the employee is not assigned (duplicate-assignment check).
   */
  findByProjectAndEmployee(
    projectId: ProjectId,
    employeeId: string,
  ): Promise<ResourceAssignment | undefined>;

  /** Loads an assignment by id, or `undefined` when it does not exist. */
  findById(id: AssignmentId): Promise<ResourceAssignment | undefined>;

  /** Lists the assignments of a project (project member read model). */
  listByProject(projectId: ProjectId): Promise<readonly ResourceAssignment[]>;

  /** Persists the aggregate (insert or update by id). */
  save(assignment: ResourceAssignment): Promise<void>;
}
