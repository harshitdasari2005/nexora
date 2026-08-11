/**
 * @nexora/application-workspaces — ListWorkspaces query.
 *
 * Lists the workspaces of an organization (CQRS read side; BACKEND.md §8).
 */

import type { TenantId } from '@nexora/contracts/common';

import type { WorkspaceDto } from '../dto/workspace.dto.js';

/** Lists the workspaces of an organization. */
export interface ListWorkspacesQuery {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
}

/** The result of {@link ListWorkspacesQuery}. */
export type ListWorkspacesResult = readonly WorkspaceDto[];
