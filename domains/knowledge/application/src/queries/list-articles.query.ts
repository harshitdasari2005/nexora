/**
 * @nexora/application-knowledge — ListArticles query.
 *
 * Lists the articles of the trusted workspace, newest first (workspace-scoped
 * read — never cross-workspace). Drafts are visible to workspace members in
 * the app UI; retrieval (the AI path) filters to published articles at index
 * time — this query returns the workspace's articles for the KB UI.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** Lists the articles of a workspace. */
export interface ListArticlesQuery {
  /** The trusted tenant id. */
  tenantId: TenantId;
  /** The trusted workspace id. */
  workspaceId: WorkspaceId;
}
