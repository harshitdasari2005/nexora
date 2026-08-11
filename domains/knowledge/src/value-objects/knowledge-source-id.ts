/**
 * @nexora/domain-knowledge — KnowledgeSourceId.
 *
 * The identity of a {@link KnowledgeSource} (the indexed entry of a
 * document). Values are branded strings (`ksrc_...`) created with
 * `@nexora/shared/ids` {@link prefixedId} (PERSISTENCE.md §1).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidKnowledgeValueError } from '../errors/index.js';

/** Knowledge source id literal pattern: `ksrc_` + RFC-4122 UUID v4. */
const KNOWLEDGE_SOURCE_ID_PATTERN =
  /^ksrc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A branded knowledge source id. */
export type KnowledgeSourceId = EntityId<'knowledge_source'>;

/**
 * Factory for {@link KnowledgeSourceId} values.
 */
export const KnowledgeSourceId = {
  /** Generates a new unique source id (`ksrc_...`). */
  create(): KnowledgeSourceId {
    return prefixedId('ksrc') as KnowledgeSourceId;
  },

  /**
   * Reconstructs a {@link KnowledgeSourceId} from a stored string.
   *
   * @throws {InvalidKnowledgeValueError} when the value is not a valid id.
   */
  from(value: string): KnowledgeSourceId {
    if (!KNOWLEDGE_SOURCE_ID_PATTERN.test(value)) {
      throw new InvalidKnowledgeValueError('Invalid knowledge source id', [
        { path: 'sourceId', message: 'Must be a valid knowledge source id' },
      ]);
    }
    return value as KnowledgeSourceId;
  },
};
