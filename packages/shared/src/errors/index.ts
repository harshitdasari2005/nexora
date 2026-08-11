/**
 * @nexora/shared — base error hierarchy.
 *
 * Every error raised by platform code derives from {@link NexoraError} and
 * carries a stable `code` aligned with the API error taxonomy
 * (API_CONTRACTS.md §10). Domain modules extend this hierarchy with their own
 * codes; they never throw raw `Error`s across module boundaries
 * (ENGINEERING_PLAYBOOK.md §4.2).
 */

import type { ErrorCode } from '../constants/index.js';

/** A field-scoped validation issue produced by the validation helpers. */
export interface FieldIssue {
  /** Path to the field, dot-separated, e.g. `employee.email`. */
  path: string;
  /** Human-readable reason the value is invalid. */
  message: string;
}

/** Base class for all Nexora platform errors. */
export class NexoraError extends Error {
  /** Stable machine-readable code (API_CONTRACTS.md §10). */
  readonly code: ErrorCode;
  /** Optional structured details (e.g. field issues, request id). */
  readonly details?: unknown;

  /**
   * @param message - human-readable message.
   * @param code    - stable error code.
   * @param details - optional structured details.
   * @param cause   - optional originating error.
   */
  constructor(message: string, code: ErrorCode, details?: unknown, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** Input failed one or more validation rules. */
export class ValidationError extends NexoraError {
  /** The field issues that caused the failure. */
  readonly issues: readonly FieldIssue[];

  constructor(message: string, issues: readonly FieldIssue[], details?: unknown, cause?: unknown) {
    super(message, 'VALIDATION_ERROR', details, cause);
    this.issues = issues;
  }
}

/** The actor is not permitted to perform the action. */
export class AuthorizationError extends NexoraError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'AUTHORIZATION_ERROR', details, cause);
  }
}

/** The requested resource does not exist or is not visible to the actor. */
export class NotFoundError extends NexoraError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'NOT_FOUND', details, cause);
  }
}

/** The operation conflicts with the current state (e.g. optimistic-lock failure). */
export class ConflictError extends NexoraError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'CONFLICT', details, cause);
  }
}

/** A domain invariant or business rule was violated (BR-*, R-*). */
export class BusinessRuleViolationError extends NexoraError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'BUSINESS_RULE_VIOLATION', details, cause);
  }
}

/** A policy evaluation denied the operation (deny-wins, AIR.md §13). */
export class PolicyViolationError extends NexoraError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'POLICY_VIOLATION', details, cause);
  }
}

/** The caller exceeded a rate limit. */
export class RateLimitedError extends NexoraError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'RATE_LIMITED', details, cause);
  }
}

/** An operation exceeded its time budget. */
export class TimeoutError extends NexoraError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'TIMEOUT', details, cause);
  }
}

/** A required dependency is unavailable (circuit open, downstream down). */
export class UnavailableError extends NexoraError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'UNAVAILABLE', details, cause);
  }
}

/** An unexpected internal failure occurred; no typed cause is known. */
export class InternalError extends NexoraError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'INTERNAL_ERROR', details, cause);
  }
}

/** Type guard: true when the value is a NexoraError (any subclass). */
export function isNexoraError(value: unknown): value is NexoraError {
  return value instanceof NexoraError;
}

/** Type guard: true when the value is a ValidationError carrying issues. */
export function isValidationError(value: unknown): value is ValidationError {
  return value instanceof ValidationError;
}

/**
 * Normalizes an unknown thrown value into a {@link NexoraError}. Only true
 * {@link NexoraError} instances (or subclasses, incl. domain errors that
 * extend the shared hierarchy) pass through unchanged — foreign errors with
 * a `code`-like property are wrapped in an {@link InternalError} rather than
 * passed through, so the canonical taxonomy (API_CONTRACTS.md §10) is
 * preserved. Use at application-layer boundaries so unexpected failures stay
 * typed (ENGINEERING_PLAYBOOK.md §4.2 error handling).
 */
export function toNexoraError(error: unknown, fallbackMessage = 'Unexpected error'): NexoraError {
  if (isNexoraError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return new InternalError(error.message, undefined, error);
  }
  return new InternalError(fallbackMessage, undefined, error);
}
