/**
 * @nexora/domain-documents — DocumentStatus.
 *
 * The processing lifecycle of a {@link Document}: `uploaded → processing →
 * available` (with `failed` from processing, retryable back to processing)
 * and `available → archived`. Status changes flow through the aggregate so
 * the transition table stays the single source of truth.
 */

/** The document lifecycle status values. */
export const DOCUMENT_STATUS_VALUES = {
  uploaded: 'uploaded',
  processing: 'processing',
  available: 'available',
  failed: 'failed',
  archived: 'archived',
} as const;

/** The document lifecycle status. */
export type DocumentStatusValue =
  (typeof DOCUMENT_STATUS_VALUES)[keyof typeof DOCUMENT_STATUS_VALUES];

/** A validated document status. */
export class DocumentStatus {
  readonly #value: DocumentStatusValue;

  private constructor(value: DocumentStatusValue) {
    this.#value = value;
  }

  /** The status value. */
  get value(): DocumentStatusValue {
    return this.#value;
  }

  /** The initial status of an uploaded document. */
  static uploaded(): DocumentStatus {
    return new DocumentStatus(DOCUMENT_STATUS_VALUES.uploaded);
  }

  /** Processing (extraction/indexing in progress). */
  static processing(): DocumentStatus {
    return new DocumentStatus(DOCUMENT_STATUS_VALUES.processing);
  }

  /** Processed and available for knowledge retrieval. */
  static available(): DocumentStatus {
    return new DocumentStatus(DOCUMENT_STATUS_VALUES.available);
  }

  /** Processing failed (retryable). */
  static failed(): DocumentStatus {
    return new DocumentStatus(DOCUMENT_STATUS_VALUES.failed);
  }

  /** Archived (terminal in v1 — no longer searchable). */
  static archived(): DocumentStatus {
    return new DocumentStatus(DOCUMENT_STATUS_VALUES.archived);
  }

  /** Whether the document is currently searchable (available). */
  isAvailable(): boolean {
    return this.#value === DOCUMENT_STATUS_VALUES.available;
  }

  /** Reconstructs a status from a persisted value. */
  static from(value: string): DocumentStatus {
    const status = Object.values(DOCUMENT_STATUS_VALUES).find((candidate) => candidate === value);
    if (status === undefined) {
      throw new Error(`Unknown document status: ${value}`);
    }
    return new DocumentStatus(status);
  }
}
