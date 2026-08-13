/**
 * @nexora/domain-knowledge — KnowledgeArticleId.
 *
 * The identity of a {@link KnowledgeArticle} (S18 Knowledge Base). Values
 * are branded strings (`art_...`) created with `@nexora/shared/ids`
 * {@link prefixedId} (PERSISTENCE.md §1). The `art_` prefix keeps the
 * article id space disjoint from document ids (`doc_`) so both corpus
 * members can share the search index scope without collision.
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidKnowledgeValueError } from '../errors/index.js';

/** Knowledge article id literal pattern: `art_` + RFC-4122 UUID v4. */
const KNOWLEDGE_ARTICLE_ID_PATTERN =
  /^art_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A branded knowledge article id. */
export type KnowledgeArticleId = EntityId<'knowledge_article'>;

/**
 * Factory for {@link KnowledgeArticleId} values.
 */
export const KnowledgeArticleId = {
  /** Generates a new unique article id (`art_...`). */
  create(): KnowledgeArticleId {
    return prefixedId('art') as KnowledgeArticleId;
  },

  /**
   * Reconstructs a {@link KnowledgeArticleId} from a stored string.
   *
   * @throws {InvalidKnowledgeValueError} when the value is not a valid id.
   */
  from(value: string): KnowledgeArticleId {
    if (!KNOWLEDGE_ARTICLE_ID_PATTERN.test(value)) {
      throw new InvalidKnowledgeValueError('Invalid knowledge article id', [
        { path: 'articleId', message: 'Must be a valid knowledge article id' },
      ]);
    }
    return value as KnowledgeArticleId;
  },
};
