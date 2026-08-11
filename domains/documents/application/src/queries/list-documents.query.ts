/**
 * @nexora/application-documents — ListDocuments query.
 *
 * The workspace-scoped read of the documents of the current workspace
 * (DOMAIN_MODEL.md §14 Documents). The workspace is TRUSTED server-side
 * scope — the query never accepts an arbitrary workspace.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** Lists the documents of a workspace, newest first. */
export interface ListDocumentsQuery {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
}
