/**
 * @nexora/application-projects — project DTO.
 *
 * The public representation of a project returned by queries and APIs.
 * Internal aggregates never cross module boundaries.
 */

import type { Project } from '@nexora/domain-projects';

/** The public project representation. */
export interface ProjectDto {
  /** The project id. */
  id: string;
  /** The owning organization (tenant) id. */
  organizationId: string;
  /** The name. */
  name: string;
  /** The optional description. */
  description?: string;
  /** The lifecycle status (`proposed` | `active` | `on_hold` | `completed` | `archived` | `cancelled`). */
  status: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** Maps a {@link Project} aggregate to its {@link ProjectDto}. */
export function toProjectDto(project: Project): ProjectDto {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name.value,
    description: project.description.value,
    status: project.status.value,
    createdAt: project.createdAt,
  };
}
