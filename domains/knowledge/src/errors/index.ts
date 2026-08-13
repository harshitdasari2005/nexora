/**
 * @nexora/domain-knowledge — domain errors.
 *
 * The Knowledge bounded context error vocabulary (DOMAIN_MODEL.md §14
 * Knowledge; API_CONTRACTS.md §10 taxonomy). Every error extends the shared
 * `NexoraError` hierarchy.
 */

import { NexoraError, ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';

/** Base class for every Knowledge domain error. */
export class KnowledgeDomainError extends NexoraError {
  constructor(
    message: string,
    code: ErrorCode = 'BUSINESS_RULE_VIOLATION',
    details?: unknown,
    cause?: unknown,
  ) {
    super(message, code, details, cause);
  }
}

/** A value object rejected its input during construction. */
export class InvalidKnowledgeValueError extends KnowledgeDomainError {
  /** The field issues that failed. */
  readonly issues: readonly FieldIssue[];

  constructor(message: string, issues: readonly FieldIssue[], details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.issues = issues;
  }
}

/** The knowledge source does not exist (or is not visible to the caller). */
export class KnowledgeSourceNotFoundError extends KnowledgeDomainError {
  constructor(details?: unknown) {
    super('Knowledge source not found', 'NOT_FOUND', details);
  }
}

/** The knowledge article does not exist (or is not visible to the caller). */
export class KnowledgeArticleNotFoundError extends KnowledgeDomainError {
  constructor(details?: unknown) {
    super('Knowledge article not found', 'NOT_FOUND', details);
  }
}

/** The knowledge category does not exist (or is not visible to the caller). */
export class KnowledgeCategoryNotFoundError extends KnowledgeDomainError {
  constructor(details?: unknown) {
    super('Knowledge category not found', 'NOT_FOUND', details);
  }
}

/** A category with the same name already exists in the workspace (name is unique per scope). */
export class KnowledgeCategoryNameAlreadyExistsError extends KnowledgeDomainError {
  constructor(details?: unknown) {
    super(
      'A knowledge category with this name already exists in the workspace',
      'CONFLICT',
      details,
    );
  }
}

/**
 * Maps any thrown value onto the Knowledge domain error vocabulary.
 */
export function toKnowledgeError(error: unknown): KnowledgeDomainError {
  if (error instanceof KnowledgeDomainError) {
    return error;
  }
  if (error instanceof ValidationError) {
    return new InvalidKnowledgeValueError(error.message, error.issues, error.details);
  }
  if (error instanceof Error) {
    return new KnowledgeDomainError(error.message, 'INTERNAL_ERROR', undefined, error);
  }
  return new KnowledgeDomainError(String(error), 'INTERNAL_ERROR');
}
