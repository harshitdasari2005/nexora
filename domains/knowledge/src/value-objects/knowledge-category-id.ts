/**
 * @nexora/domain-knowledge — KnowledgeCategoryId.
 *
 * The identity of a {@link KnowledgeCategory} (S18 Knowledge Base). Values
 * are branded strings (`kcat_...`) created with `@nexora/shared/ids`
 * {@link prefixedId} (PERSISTENCE.md §1).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidKnowledgeValueError } from '../errors/index.js';

/** Knowledge category id literal pattern: `kcat_` + RFC-4122 UUID v4. */
const KNOWLEDGE_CATEGORY_ID_PATTERN =
  /^kcat_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A branded knowledge category id. */
export type KnowledgeCategoryId = EntityId<'knowledge_category'>;

/**
 * Factory for {@link KnowledgeCategoryId} values.
 */
export const KnowledgeCategoryId = {
  /** Generates a new unique category id (`kcat_...`). */
  create(): KnowledgeCategoryId {
    return prefixedId('kcat') as KnowledgeCategoryId;
  },

  /**
   * Reconstructs a {@link KnowledgeCategoryId} from a stored string.
   *
   * @throws {InvalidKnowledgeValueError} when the value is not a valid id.
   */
  from(value: string): KnowledgeCategoryId {
    if (!KNOWLEDGE_CATEGORY_ID_PATTERN.test(value)) {
      throw new InvalidKnowledgeValueError('Invalid knowledge category id', [
        { path: 'categoryId', message: 'Must be a valid knowledge category id' },
      ]);
    }
    return value as KnowledgeCategoryId;
  },
};
