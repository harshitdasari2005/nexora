/**
 * @nexora/application-knowledge — knowledge article DTO.
 *
 * The public representation of a knowledge article (S18 Knowledge Base).
 * Unlike documents, article content is TEXT — the body is part of the DTO
 * (there is no storage reference to hide). The lifecycle status and the
 * monotonic contentVersion are the publication + freshness contract.
 */

import type { KnowledgeArticle } from '@nexora/domain-knowledge';

/** The public article representation. */
export interface KnowledgeArticleDto {
  /** The article id. */
  id: string;
  /** The owning organization (tenant) id. */
  tenantId: string;
  /** The owning workspace id. */
  workspaceId: string;
  /** The article title. */
  title: string;
  /** The article body. */
  body: string;
  /** The optional owning category id. */
  categoryId?: string;
  /** The lifecycle status (`draft` | `published` | `archived`). */
  status: string;
  /** The monotonic content version (cited by retrieval). */
  contentVersion: number;
  /** The authoring user id. */
  author: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
}

/** Maps a {@link KnowledgeArticle} aggregate to its DTO. */
export function toKnowledgeArticleDto(article: KnowledgeArticle): KnowledgeArticleDto {
  return {
    id: article.id,
    tenantId: article.tenantId,
    workspaceId: article.workspaceId,
    title: article.title,
    body: article.body,
    categoryId: article.categoryId,
    status: article.status.value,
    contentVersion: article.contentVersion,
    author: article.author,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  };
}
