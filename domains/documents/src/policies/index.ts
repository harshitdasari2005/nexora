/**
 * @nexora/domain-documents — domain policies.
 *
 * The Documents bounded context business rules (DOMAIN_MODEL.md §14
 * Documents), extracted so aggregate invariants stay in one authoritative
 * place. Policies are pure: no I/O, typed domain errors on violation.
 */

import { InvalidDocumentValueError, DocumentStateTransitionError } from '../errors/index.js';
import type { DocumentStatus } from '../value-objects/document-status.js';
import type { DocumentStatusValue } from '../value-objects/document-status.js';

/**
 * The document lifecycle transition table (vertical slice v1):
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Uploaded
 *     Uploaded --> Processing
 *     Processing --> Available
 *     Processing --> Failed: extraction error
 *     Failed --> Processing: reprocess
 *     Available --> Archived
 * ```
 *
 * `archived` is terminal in v1. `failed` is retryable (reprocessing), so a
 * transient extraction error never silently loses a document.
 */
export const DOCUMENT_TRANSITIONS: Readonly<
  Record<DocumentStatusValue, readonly DocumentStatusValue[]>
> = {
  uploaded: ['processing'],
  processing: ['available', 'failed'],
  failed: ['processing'],
  available: ['archived'],
  archived: [],
};

/** Document lifecycle rules: allowed status transitions. */
export class DocumentLifecyclePolicy {
  /** The statuses reachable from the given status. */
  allowedTargets(current: DocumentStatus): readonly DocumentStatusValue[] {
    return DOCUMENT_TRANSITIONS[current.value];
  }

  /**
   * Asserts the document may transition to the target status.
   *
   * @throws {DocumentStateTransitionError} when the transition is not allowed.
   */
  assertCanTransition(current: DocumentStatus, target: DocumentStatus): void {
    const allowed = this.allowedTargets(current);
    if (!allowed.includes(target.value)) {
      throw new DocumentStateTransitionError(
        `Cannot transition a document from ${current.value} to ${target.value}`,
        { from: current.value, to: target.value },
      );
    }
  }
}

/** Document value invariants: a title is required and bounded. */
export class DocumentValuePolicy {
  /**
   * Asserts a document title is non-empty and within the platform limit.
   *
   * @throws {InvalidDocumentValueError} when the title is empty or too long.
   */
  assertValidTitle(title: string, maxLength = 200): void {
    const value = title.trim();
    const issues: { path: string; message: string }[] = [];
    if (value.length === 0) {
      issues.push({ path: 'title', message: 'Must not be empty' });
    } else if (value.length > maxLength) {
      issues.push({ path: 'title', message: `Must be at most ${maxLength} characters` });
    }
    if (issues.length > 0) {
      throw new InvalidDocumentValueError('Invalid document title', issues);
    }
  }
}
