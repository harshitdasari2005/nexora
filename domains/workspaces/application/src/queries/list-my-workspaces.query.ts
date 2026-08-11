/**
 * @nexora/application-workspaces — ListMyWorkspaces query.
 *
 * The membership-scoped workspace query (CQRS read side): returns the
 * workspaces the *authenticated user* is a member of, inside a tenant. This
 * is the authorization query the AI tool delegates to — the AI never
 * filters by its own claims; the application layer enforces membership
 * (single authorization system, security contract).
 */

import type { TenantId, UserId } from '@nexora/contracts/common';

import type { WorkspaceDto } from '../dto/workspace.dto.js';

/** Lists the workspaces a user is a member of within an organization. */
export interface ListMyWorkspacesQuery {
  /** The authenticated user (trusted server-side identity). */
  userId: UserId;
  /** The tenant (organization) scope (trusted). */
  organizationId: TenantId;
}

/** The result of {@link ListMyWorkspacesQuery}: the user's authorized workspaces. */
export type ListMyWorkspacesResult = readonly WorkspaceDto[];
