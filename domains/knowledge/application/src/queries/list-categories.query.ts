/**
 * @nexora/application-knowledge — ListCategories query.
 *
 * Lists the categories of the trusted workspace (workspace-scoped read).
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** Lists the categories of a workspace. */
export interface ListCategoriesQuery {
  /** The trusted tenant id. */
  tenantId: TenantId;
  /** The trusted workspace id. */
  workspaceId: WorkspaceId;
}
