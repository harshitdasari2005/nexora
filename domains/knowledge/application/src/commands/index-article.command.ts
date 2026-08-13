/**
 * @nexora/application-knowledge — IndexArticle command.
 *
 * The use case that puts a PUBLISHED knowledge article into the search
 * corpus (S18 Knowledge Base). Articles are indexed directly through the
 * generic {@link SearchIndexPort} — no KnowledgeSource aggregate exists for
 * articles (that aggregate is document-shaped). The entry carries
 * `kind = article`, `scopeId = articleId`, and `version = contentVersion` so
 * citations can reference the exact version consulted (AIR §9.3).
 *
 * The tenant + workspace are TRUSTED server-side scope; the caller (the
 * orchestration layer) verifies the article is published BEFORE indexing —
 * a draft can never reach the corpus.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** Indexes a published knowledge article. */
export interface IndexArticleCommand {
  /** The owning organization (tenant) id — trusted scope. */
  tenantId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The article id (also the index entry id — stable across re-indexes). */
  articleId: string;
  /** The display title (the citation label). */
  title: string;
  /** The normalized searchable body text. */
  text: string;
  /** The indexed content version (the article's monotonic contentVersion). */
  version: number;
}
