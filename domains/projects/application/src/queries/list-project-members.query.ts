/**
 * @nexora/application-projects — ListProjectMembers query.
 *
 * Lists the employees assigned to a project (CQRS read side; BACKEND.md
 * §8). Tenant-scoped: the project must belong to the organization, and only
 * that project's assignments are returned. Employee names are joined by the
 * HTTP/orchestration layer via the HR application service — the Projects
 * layer returns assignment records (employee ids) only.
 */

import type { TenantId } from '@nexora/contracts/common';

import type { ProjectMemberDto } from '../dto/project-member.dto.js';

/** Lists the members of a project within an organization. */
export interface ListProjectMembersQuery {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The project id. */
  projectId: string;
}

/** The result of {@link ListProjectMembersQuery}. */
export type ListProjectMembersResult = readonly ProjectMemberDto[];
