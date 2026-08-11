/**
 * @nexora/domain-documents — DocumentTitle.
 *
 * The human-readable title of a {@link Document}. Always validated at the
 * value-object boundary — a malformed title never becomes an aggregate.
 */

import { InvalidDocumentValueError } from '../errors/index.js';

/** The maximum title length (mirrors the API validator). */
export const DOCUMENT_TITLE_MAX_LENGTH = 200;

/** A validated document title. */
export class DocumentTitle {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /** The raw title string. */
  get value(): string {
    return this.#value;
  }

  /**
   * Validates and creates a title. Throws {@link InvalidDocumentValueError}
   * when the value is empty or too long.
   */
  static create(value: string): DocumentTitle {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new InvalidDocumentValueError('A document title is required', [
        { path: 'title', message: 'A document title is required' },
      ]);
    }
    if (trimmed.length > DOCUMENT_TITLE_MAX_LENGTH) {
      throw new InvalidDocumentValueError(
        `Document title must be at most ${DOCUMENT_TITLE_MAX_LENGTH} characters`,
        [
          {
            path: 'title',
            message: `Document title must be at most ${DOCUMENT_TITLE_MAX_LENGTH} characters`,
          },
        ],
      );
    }
    return new DocumentTitle(trimmed);
  }
}
