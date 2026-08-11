/**
 * @nexora/domain-documents — DocumentId.
 *
 * The identity of a {@link Document} (contracts `EntityId<'document'>`).
 * Values are branded strings (`doc_...`) created with `@nexora/shared/ids`
 * {@link prefixedId} (PERSISTENCE.md §1 aggregate ownership).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidDocumentValueError } from '../errors/index.js';

/** Document id literal pattern: `doc_` + RFC-4122 UUID v4 (the `prefixedId` shape). */
const DOCUMENT_ID_PATTERN = /^doc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A branded document id. */
export type DocumentId = EntityId<'document'>;

/**
 * Factory for {@link DocumentId} values. The type and namespace share a
 * name so call sites read naturally: `DocumentId.create()`.
 */
export const DocumentId = {
  /** Generates a new unique document id (`doc_...`). */
  create(): DocumentId {
    return prefixedId('doc') as DocumentId;
  },

  /**
   * Reconstructs a {@link DocumentId} from a stored string
   * (infrastructure boundary).
   *
   * @throws {InvalidDocumentValueError} when the value is not a valid id.
   */
  from(value: string): DocumentId {
    if (!DOCUMENT_ID_PATTERN.test(value)) {
      throw new InvalidDocumentValueError('Invalid document id', [
        { path: 'documentId', message: 'Must be a valid document id' },
      ]);
    }
    return value as DocumentId;
  },
};
