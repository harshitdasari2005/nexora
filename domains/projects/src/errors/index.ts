/**
 * @nexora/domain-projects — domain errors.
 *
 * The Projects bounded context error vocabulary (DOMAIN_MODEL.md §14
 * Projects; API_CONTRACTS.md §10 taxonomy). Every error extends the shared
 * `NexoraError` hierarchy so codes stay canonical and cross-boundary error
 * handling works unchanged (ENGINEERING_PLAYBOOK.md §4.2).
 */

import { NexoraError, ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';

/**
 * Base class for every Projects domain error. All concrete errors extend
 * this so services can catch the whole bounded-context family with one
 * `instanceof` check.
 */
export class ProjectDomainError extends NexoraError {
  /**
   * @param message - human-readable message.
   * @param code    - canonical error code (API_CONTRACTS.md §10).
   * @param details - optional structured details.
   * @param cause   - optional originating error.
   */
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
 * (malformed name, invalid status, ...). Carries field issues and the
 * canonical `VALIDATION_ERROR` code. `toProjectError` maps shared
 * {@link ValidationError}s onto this type so callers see one validation
 * error family.
 */
export class InvalidProjectValueError extends ProjectDomainError {
  /** The field issues that failed. */
  readonly issues: readonly FieldIssue[];

  constructor(message: string, issues: readonly FieldIssue[], details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.issues = issues;
  }
}

/** The project does not exist (or is not visible to the caller). */
export class ProjectNotFoundError extends ProjectDomainError {
  constructor(details?: unknown) {
    super('Project not found', 'NOT_FOUND', details);
  }
}

/** A project lifecycle transition was attempted that the policy forbids. */
export class ProjectStateTransitionError extends ProjectDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** A project is archived and rejects every mutation (immutable). */
export class ProjectArchivedError extends ProjectDomainError {
  constructor(details?: unknown) {
    super('Project is archived', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** A project is cancelled (terminal) and rejects every mutation. */
export class ProjectCancelledError extends ProjectDomainError {
  constructor(details?: unknown) {
    super('Project is cancelled', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** A project cannot receive members because it is not in an assignable state. */
export class ProjectNotAssignableError extends ProjectDomainError {
  constructor(details?: unknown) {
    super('Project is not assignable', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The employee is already assigned to the project (duplicate assignment). */
export class DuplicateAssignmentError extends ProjectDomainError {
  constructor(details?: unknown) {
    super('Employee is already assigned to this project', 'CONFLICT', details);
  }
}

/**
 * Maps any thrown value onto the Projects domain error vocabulary. Shared
 * {@link ValidationError}s become {@link InvalidProjectValueError}s; unknown
 * errors become internal {@link ProjectDomainError}s (never rethrown raw).
 */
export function toProjectError(error: unknown): ProjectDomainError {
  if (error instanceof ProjectDomainError) {
    return error;
  }
  if (error instanceof ValidationError) {
    return new InvalidProjectValueError(error.message, error.issues, error.details);
  }
  if (error instanceof Error) {
    return new ProjectDomainError(error.message, 'INTERNAL_ERROR', undefined, error);
  }
  return new ProjectDomainError(String(error), 'INTERNAL_ERROR');
}
