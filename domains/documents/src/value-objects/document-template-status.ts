/**
 * @nexora/domain-documents — DocumentTemplateStatus.
 *
 * The lifecycle status of a {@link DocumentTemplate}: `active` (usable to
 * create documents) or `archived` (removed from the picker; terminal in v1).
 * Archived is distinct from a document's `archived` lifecycle — the two
 * lifecycles never mix.
 */

import { InvalidDocumentValueError } from '../errors/index.js';

/** The template lifecycle status values. */
export const DOCUMENT_TEMPLATE_STATUSES = {
  active: 'active',
  archived: 'archived',
} as const;

/** A template lifecycle status value. */
export type DocumentTemplateStatusValue =
  (typeof DOCUMENT_TEMPLATE_STATUSES)[keyof typeof DOCUMENT_TEMPLATE_STATUSES];

/** A validated template lifecycle status. */
export class DocumentTemplateStatus {
  readonly #value: DocumentTemplateStatusValue;

  private constructor(value: DocumentTemplateStatusValue) {
    this.#value = value;
  }

  /** The raw status value. */
  get value(): DocumentTemplateStatusValue {
    return this.#value;
  }

  /** Whether the template can be used to create documents. */
  isActive(): boolean {
    return this.#value === DOCUMENT_TEMPLATE_STATUSES.active;
  }

  /** Creates an `active` template status. */
  static active(): DocumentTemplateStatus {
    return new DocumentTemplateStatus(DOCUMENT_TEMPLATE_STATUSES.active);
  }

  /** Creates an `archived` template status (terminal in v1). */
  static archived(): DocumentTemplateStatus {
    return new DocumentTemplateStatus(DOCUMENT_TEMPLATE_STATUSES.archived);
  }

  /**
   * Reconstructs a status from a stored string.
   *
   * @throws {InvalidDocumentValueError} when the value is not a known status.
   */
  static from(value: string): DocumentTemplateStatus {
    if (
      value === DOCUMENT_TEMPLATE_STATUSES.active ||
      value === DOCUMENT_TEMPLATE_STATUSES.archived
    ) {
      return new DocumentTemplateStatus(value);
    }
    throw new InvalidDocumentValueError(`Unknown document template status: ${value}`, [
      { path: 'status', message: 'Must be active or archived' },
    ]);
  }
}
