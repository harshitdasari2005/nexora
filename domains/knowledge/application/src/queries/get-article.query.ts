/**
 * @nexora/application-knowledge — GetArticle query.
 *
 * Reads one article within the trusted tenant + workspace (workspace-scoped
 * read). A foreign or forged article id resolves to NOT FOUND, never to
 * another workspace's article.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** Reads a single knowledge article. */
export interface GetArticleQuery {
  /** The trusted tenant id. */
  tenantId: TenantId;
  /** The trusted workspace id. */
  workspaceId: WorkspaceId;
  /** The article id. */
  articleId: string;
}
