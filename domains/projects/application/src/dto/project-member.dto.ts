/**
 * @nexora/application-projects — project member DTO.
 *
 * The public representation of an assignment returned by queries and APIs.
 * The employee is referenced by id; the HTTP layer joins the display name
 * through the HR application service (cross-bounded-context composition
 * happens at the orchestration boundary, never inside a domain).
 */

import type { ResourceAssignment } from '@nexora/domain-projects';

/** The public project-member (assignment) representation. */
export interface ProjectMemberDto {
  /** The assignment id. */
  id: string;
  /** The project the employee is assigned to. */
  projectId: string;
  /** The assigned employee id (HR bounded context reference). */
  employeeId: string;
  /** ISO-8601 UTC assignment time. */
  assignedAt: string;
}

/** Maps a {@link ResourceAssignment} aggregate to its {@link ProjectMemberDto}. */
export function toProjectMemberDto(assignment: ResourceAssignment): ProjectMemberDto {
  return {
    id: assignment.id,
    projectId: assignment.projectId,
    employeeId: assignment.employeeId,
    assignedAt: assignment.assignedAt,
  };
}
