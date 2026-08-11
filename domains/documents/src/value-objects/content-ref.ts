/**
 * @nexora/domain-documents — ContentRef.
 *
 * The opaque reference to the stored binary content of a {@link Document}
 * (the storage key handed to the {@link DocumentStorage} port). The domain
 * never sees bytes — metadata and content are separated by design
 * (PERSISTENCE.md §2 multi-model: metadata relational, content in object
 * storage).
 */

import { InvalidDocumentValueError } from '../errors/index.js';

/** The maximum content-ref length. */
export const CONTENT_REF_MAX_LENGTH = 256;

/** A validated storage reference. */
export class ContentRef {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /** The raw storage key. */
  get value(): string {
    return this.#value;
  }

  /** Validates and creates a content reference. */
  static create(value: string): ContentRef {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new InvalidDocumentValueError('A content reference is required', [
        { path: 'contentRef', message: 'A content reference is required' },
      ]);
    }
    if (trimmed.length > CONTENT_REF_MAX_LENGTH) {
      throw new InvalidDocumentValueError('Content reference is too long', [
        { path: 'contentRef', message: 'Content reference is too long' },
      ]);
    }
    return new ContentRef(trimmed);
  }

  /** Builds the content reference for a document version. */
  static forDocument(documentId: string, version: number): ContentRef {
    return new ContentRef(`doc/${documentId}/v${version}`);
  }
}
