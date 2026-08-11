/**
 * @nexora/application-projects — ListProjects query.
 *
 * Lists the projects of an organization (CQRS read side; BACKEND.md §8).
 * The organization is the trusted tenant scope — never a model-supplied
 * value.
 */

import type { TenantId } from '@nexora/contracts/common';

import type { ProjectDto } from '../dto/project.dto.js';

/** Lists the projects of an organization. */
export interface ListProjectsQuery {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
}

/** The result of {@link ListProjectsQuery}. */
export type ListProjectsResult = readonly ProjectDto[];
