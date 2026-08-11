/**
 * @nexora/domain-identity — domain errors.
 *
 * The Identity & Access bounded context error vocabulary (DOMAIN_MODEL.md
 * §2.2). Every error extends the shared `NexoraError` hierarchy so codes
 * stay canonical (API_CONTRACTS.md §10 taxonomy) and cross-boundary error
 * handling works unchanged (ENGINEERING_PLAYBOOK.md §4.2).
 */

import { NexoraError, ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';

/**
 * Base class for every Identity domain error. All concrete errors extend
 * this so services can catch the whole bounded-context family with one
 * `instanceof` check.
 */
export class IdentityDomainError extends NexoraError {
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
 * A value object or entity rejected its input during construction (malformed
 * email, invalid username, ...). Carries field issues and the canonical
 * `VALIDATION_ERROR` code. Extends the shared {@link ValidationError} so it
 * remains an `IdentityDomainError` and a `ValidationError` at the same time
 * via composition of this subclass.
 */
export class InvalidIdentityValueError extends IdentityDomainError {
  /** The field issues that failed. */
  readonly issues: readonly FieldIssue[];

  constructor(message: string, issues: readonly FieldIssue[], details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.issues = issues;
  }
}

/** The user does not exist (or is not visible to the caller). */
export class UserNotFoundError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('User not found', 'NOT_FOUND', details);
  }
}

/** A user with the same email or username already exists. */
export class UserAlreadyExistsError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('User already exists', 'CONFLICT', details);
  }
}

/** The supplied credentials do not match any active identity. */
export class InvalidCredentialsError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('Invalid credentials', 'AUTHORIZATION_ERROR', details);
  }
}

/** The user is not in an active state and cannot perform the action. */
export class UserNotActiveError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('User is not active', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** A user lifecycle transition was attempted that the policy forbids. */
export class UserStateTransitionError extends IdentityDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The session does not exist. */
export class SessionNotFoundError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('Session not found', 'NOT_FOUND', details);
  }
}

/** The session has expired and can no longer be used. */
export class SessionExpiredError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('Session expired', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The session was ended or revoked and can no longer be used. */
export class SessionRevokedError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('Session revoked', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The user exceeded the maximum number of concurrent sessions. */
export class SessionLimitExceededError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('Session limit exceeded', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/**
 * A session was requested in a tenant the principal does not belong to.
 * Defense-in-depth: the session tenant must match the principal's home
 * tenant (SAD.md §13.1 tenant scoping; PSD.md §10 sessions).
 */
export class SessionTenantMismatchError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('Session tenant mismatch', 'AUTHORIZATION_ERROR', details);
  }
}

/** The role does not exist. */
export class RoleNotFoundError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('Role not found', 'NOT_FOUND', details);
  }
}

/** The role is already assigned to the user. */
export class RoleAlreadyAssignedError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('Role already assigned', 'CONFLICT', details);
  }
}

/** The role is not assigned to the user. */
export class RoleNotAssignedError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('Role not assigned', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** A permission with the same name already exists on the role. */
export class DuplicatePermissionError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('Permission already exists on role', 'CONFLICT', details);
  }
}

/** The permission does not exist on the role. */
export class PermissionNotFoundError extends IdentityDomainError {
  constructor(details?: unknown) {
    super('Permission not found on role', 'NOT_FOUND', details);
  }
}

/** Type guard: true when the value is any Identity domain error. */
export function isIdentityDomainError(value: unknown): value is IdentityDomainError {
  return value instanceof IdentityDomainError;
}

/**
 * Maps an unknown thrown value to an {@link IdentityDomainError}. Identity
 * errors and shared {@link ValidationError}s pass through unchanged; anything
 * else is wrapped so services can consistently return
 * `Result<T, IdentityDomainError>`.
 */
export function toIdentityError(error: unknown): IdentityDomainError {
  if (error instanceof IdentityDomainError) {
    return error;
  }
  if (error instanceof ValidationError) {
    return new InvalidIdentityValueError(error.message, error.issues, error.details);
  }
  if (error instanceof Error) {
    return new IdentityDomainError(error.message, 'INTERNAL_ERROR', undefined, error);
  }
  return new IdentityDomainError(String(error), 'INTERNAL_ERROR');
}
