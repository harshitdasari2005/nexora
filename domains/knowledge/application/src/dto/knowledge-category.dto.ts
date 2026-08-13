/**
 * @nexora/application-knowledge — knowledge category DTO.
 *
 * The public representation of a flat, workspace-scoped knowledge category
 * (S18 Knowledge Base).
 */

import type { KnowledgeCategory } from '@nexora/domain-knowledge';

/** The public category representation. */
export interface KnowledgeCategoryDto {
  /** The category id. */
  id: string;
  /** The owning organization (tenant) id. */
  tenantId: string;
  /** The owning workspace id. */
  workspaceId: string;
  /** The category name. */
  name: string;
  /** Whether the category is archived (terminal). */
  archived: boolean;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** Maps a {@link KnowledgeCategory} aggregate to its DTO. */
export function toKnowledgeCategoryDto(category: KnowledgeCategory): KnowledgeCategoryDto {
  return {
    id: category.id,
    tenantId: category.tenantId,
    workspaceId: category.workspaceId,
    name: category.name,
    archived: category.archived,
    createdAt: category.createdAt,
  };
}
