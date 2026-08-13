/**
 * @nexora/domain-documents — domain errors.
 *
 * The Documents bounded context error vocabulary (DOMAIN_MODEL.md §14
 * Documents; API_CONTRACTS.md §10 taxonomy). Every error extends the shared
 * `NexoraError` hierarchy so codes stay canonical and cross-boundary error
 * handling works unchanged (ENGINEERING_PLAYBOOK.md §4.2).
 */

import { NexoraError, ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';

/** Base class for every Documents domain error. */
export class DocumentDomainError extends NexoraError {
  constructor(
    message: string,
    code: ErrorCode = 'BUSINESS_RULE_VIOLATION',
    details?: unknown,
    cause?: unknown,
  ) {
    super(message, code, details, cause);
  }
}

/**
 * A value object or aggregate rejected its input during construction
 * (malformed title, invalid status, ...). Carries field issues and the
 * canonical `VALIDATION_ERROR` code.
 */
export class InvalidDocumentValueError extends DocumentDomainError {
  /** The field issues that failed. */
  readonly issues: readonly FieldIssue[];

  constructor(message: string, issues: readonly FieldIssue[], details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.issues = issues;
  }
}

/** The document does not exist (or is not visible to the caller). */
export class DocumentNotFoundError extends DocumentDomainError {
  constructor(details?: unknown) {
    super('Document not found', 'NOT_FOUND', details);
  }
}

/** A document lifecycle transition was attempted that the policy forbids. */
export class DocumentStateTransitionError extends DocumentDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** An archived document rejects every mutation (immutable, terminal in v1). */
export class DocumentArchivedError extends DocumentDomainError {
  constructor(details?: unknown) {
    super('Document is archived', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The document version does not exist (or is not visible to the caller). */
export class DocumentVersionNotFoundError extends DocumentDomainError {
  constructor(details?: unknown) {
    super('Document version not found', 'NOT_FOUND', details);
  }
}

/** The document template does not exist (or is not visible to the caller). */
export class DocumentTemplateNotFoundError extends DocumentDomainError {
  constructor(details?: unknown) {
    super('Document template not found', 'NOT_FOUND', details);
  }
}

/**
 * Maps any thrown value onto the Documents domain error vocabulary. Shared
 * {@link ValidationError}s become {@link InvalidDocumentValueError}s; unknown
 * errors become internal {@link DocumentDomainError}s (never rethrown raw).
 */
export function toDocumentError(error: unknown): DocumentDomainError {
  if (error instanceof DocumentDomainError) {
    return error;
  }
  if (error instanceof ValidationError) {
    return new InvalidDocumentValueError(error.message, error.issues, error.details);
  }
  if (error instanceof Error) {
    return new DocumentDomainError(error.message, 'INTERNAL_ERROR', undefined, error);
  }
  return new DocumentDomainError(String(error), 'INTERNAL_ERROR');
}
