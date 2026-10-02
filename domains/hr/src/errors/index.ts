/**
 * @nexora/domain-hr — domain errors.
 *
 * The HR bounded context error vocabulary (DOMAIN_MODEL.md §14.1; API_CONTRACTS.md
 * §10 taxonomy). Every error extends the shared `NexoraError` hierarchy so codes
 * stay canonical and cross-boundary error handling works unchanged
 * (ENGINEERING_PLAYBOOK.md §4.2).
 */

import { NexoraError, ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';

/**
 * Base class for every HR domain error. All concrete errors extend this so
 * services can catch the whole bounded-context family with one `instanceof`
 * check.
 */
export class HrDomainError extends NexoraError {
  constructor(
    message: string,
    code: ErrorCode = 'BUSINESS_RULE_VIOLATION',
    details?: unknown,
    cause?: unknown,
  ) {
    super(message, code, details, cause);
  }
}

/** A value object rejected its input during construction (malformed name, ...). */
export class InvalidEmployeeValueError extends HrDomainError {
  /** The field issues that failed. */
  readonly issues: readonly FieldIssue[];

  constructor(message: string, issues: readonly FieldIssue[], details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.issues = issues;
  }
}

/** The employee does not exist (or is not visible to the caller). */
export class EmployeeNotFoundError extends HrDomainError {
  constructor(details?: unknown) {
    super('Employee not found', 'NOT_FOUND', details);
  }
}

/** An employee lifecycle transition was attempted that the policy forbids. */
export class EmployeeStateTransitionError extends HrDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The employee is not active and cannot be assigned to work (BR-16). */
export class EmployeeNotActiveError extends HrDomainError {
  constructor(details?: unknown) {
    super('Employee is not active', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/**
 * Maps any thrown value onto the HR domain error vocabulary. Shared
 * {@link ValidationError}s become {@link InvalidEmployeeValueError}s; unknown
 * errors become internal {@link HrDomainError}s (never rethrown raw).
 */
export function toHrError(error: unknown): HrDomainError {
  if (error instanceof HrDomainError) {
    return error;
  }
  if (error instanceof ValidationError) {
    return new InvalidEmployeeValueError(error.message, error.issues, error.details);
  }
  if (error instanceof Error) {
    return new HrDomainError(error.message, 'INTERNAL_ERROR', undefined, error);
  }
  return new HrDomainError(String(error), 'INTERNAL_ERROR');
}

/** The hiring requisition does not exist (or is not visible to the caller). */
export class RequisitionNotFoundError extends HrDomainError {
  constructor(details?: unknown) {
    super('Hiring request not found', 'NOT_FOUND', details);
  }
}

/** A requisition transition was attempted that its current state forbids. */
export class RequisitionStateError extends HrDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The actor may not perform this step of the requisition (separation of duties, not the requester, …). */
export class RequisitionNotPermittedError extends HrDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'AUTHORIZATION_ERROR', details);
  }
}

/** The requisition changed since it was read (a concurrent decision or edit won). */
export class RequisitionConflictError extends HrDomainError {
  constructor(details?: unknown) {
    super(
      'The hiring request was changed by someone else — reload and try again',
      'CONFLICT',
      details,
    );
  }
}
