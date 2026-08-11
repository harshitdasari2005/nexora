/**
 * @nexora/module-calendar — domain errors.
 *
 * The Calendar bounded context error vocabulary (DOMAIN_MODEL.md §4.5;
 * API_CONTRACTS.md §10 taxonomy). Every error extends the shared
 * `NexoraError` hierarchy so codes stay canonical and cross-boundary error
 * handling works unchanged (ENGINEERING_PLAYBOOK.md §4.2).
 */

import { NexoraError, ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';

/**
 * Base class for every Calendar domain error. All concrete errors extend
 * this so services can catch the whole bounded-context family with one
 * `instanceof` check.
 */
export class CalendarDomainError extends NexoraError {
  constructor(
    message: string,
    code: ErrorCode = 'BUSINESS_RULE_VIOLATION',
    details?: unknown,
    cause?: unknown,
  ) {
    super(message, code, details, cause);
  }
}

/** A value object rejected its input during construction (title, window, ...). */
export class InvalidCalendarEntryValueError extends CalendarDomainError {
  /** The field issues that failed. */
  readonly issues: readonly FieldIssue[];

  constructor(message: string, issues: readonly FieldIssue[], details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.issues = issues;
  }
}

/** The calendar entry does not exist (or is not visible to the caller). */
export class CalendarEntryNotFoundError extends CalendarDomainError {
  constructor(details?: unknown) {
    super('Calendar entry not found', 'NOT_FOUND', details);
  }
}

/** A lifecycle transition was attempted that the policy forbids. */
export class CalendarEntryStateTransitionError extends CalendarDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'BUSINESS_RULE_VIOLATION', details);
  }
}

/**
 * Maps any thrown value onto the Calendar domain error vocabulary. Shared
 * {@link ValidationError}s become {@link InvalidCalendarEntryValueError}s;
 * unknown errors become internal {@link CalendarDomainError}s (never
 * rethrown raw).
 */
export function toCalendarError(error: unknown): CalendarDomainError {
  if (error instanceof CalendarDomainError) {
    return error;
  }
  if (error instanceof ValidationError) {
    return new InvalidCalendarEntryValueError(error.message, error.issues, error.details);
  }
  if (error instanceof Error) {
    return new CalendarDomainError(error.message, 'INTERNAL_ERROR', undefined, error);
  }
  return new CalendarDomainError(String(error), 'INTERNAL_ERROR');
}
