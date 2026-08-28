/**
 * @nexora/module-finance — domain errors.
 *
 * The Finance bounded context error vocabulary (DOMAIN_MODEL.md §4.4;
 * API_CONTRACTS.md §10 taxonomy). Every error extends the shared
 * `NexoraError` hierarchy so codes stay canonical and cross-boundary error
 * handling works unchanged (ENGINEERING_PLAYBOOK.md §4.2).
 */

import { NexoraError, ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';

/**
 * Base class for every Finance domain error. All concrete errors extend
 * this so services can catch the whole bounded-context family with one
 * `instanceof` check.
 */
export class FinanceDomainError extends NexoraError {
  constructor(
    message: string,
    code: ErrorCode = 'BUSINESS_RULE_VIOLATION',
    details?: unknown,
    cause?: unknown,
  ) {
    super(message, code, details, cause);
  }
}

/** A value object rejected its input during construction (name, amount, period, ...). */
export class InvalidFinanceValueError extends FinanceDomainError {
  /** The field issues that failed. */
  readonly issues: readonly FieldIssue[];

  constructor(message: string, issues: readonly FieldIssue[], details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.issues = issues;
  }
}

/** The budget does not exist (or is not visible to the caller). */
export class BudgetNotFoundError extends FinanceDomainError {
  constructor(details?: unknown) {
    super('Budget not found', 'NOT_FOUND', details);
  }
}

/** The expense does not exist (or is not visible to the caller). */
export class ExpenseNotFoundError extends FinanceDomainError {
  constructor(details?: unknown) {
    super('Expense not found', 'NOT_FOUND', details);
  }
}

/** A lifecycle transition was attempted that the policy forbids. */
export class FinanceStateTransitionError extends FinanceDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'BUSINESS_RULE_VIOLATION', details);
  }
}

/**
 * Segregation of duties (PRD §14.3.3, FR-21, BR-19): the user who submitted
 * an expense may never be the one who approves it. Approving a money
 * movement is a distinct authority from requesting it — this rule cannot be
 * relaxed by holding both capabilities.
 */
export class ExpenseSelfApprovalError extends FinanceDomainError {
  constructor(details?: unknown) {
    super(
      'The submitter of an expense cannot approve it (segregation of duties)',
      'BUSINESS_RULE_VIOLATION',
      details,
    );
  }
}

/**
 * Maps any thrown value onto the Finance domain error vocabulary. Shared
 * {@link ValidationError}s become {@link InvalidFinanceValueError}s; unknown
 * errors become internal {@link FinanceDomainError}s (never rethrown raw).
 */
export function toFinanceError(error: unknown): FinanceDomainError {
  if (error instanceof FinanceDomainError) {
    return error;
  }
  if (error instanceof ValidationError) {
    return new InvalidFinanceValueError(error.message, error.issues, error.details);
  }
  if (error instanceof Error) {
    return new FinanceDomainError(error.message, 'INTERNAL_ERROR', undefined, error);
  }
  return new FinanceDomainError(String(error), 'INTERNAL_ERROR');
}
