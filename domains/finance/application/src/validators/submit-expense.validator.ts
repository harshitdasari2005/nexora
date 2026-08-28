/**
 * @nexora/application-finance — SubmitExpense validator.
 *
 * Structural validation of the submit-expense command before the use case
 * runs. Deep domain validation (description VO, money VO) remains the
 * responsibility of the domain layer — this validator only rejects
 * malformed command input early (API_CONTRACTS.md §10 errors).
 */

import { ValidationError, type FieldIssue } from '@nexora/shared/errors';

import { MAX_MONEY_MINOR_UNITS } from './create-budget.validator.js';

/** Maximum expense-description length accepted by the API (mirrors the domain). */
export const MAX_EXPENSE_DESCRIPTION_LENGTH = 120;

/** Shape validated for expense submission. */
export interface SubmitExpenseFields {
  description: string;
  amountMinorUnits: number;
  currency: string;
}

/**
 * Validates submit-expense command fields.
 *
 * @throws {ValidationError} when the command is malformed.
 */
export function validateSubmitExpense(command: SubmitExpenseFields): void {
  const issues: FieldIssue[] = [];

  if (command.description.trim().length === 0) {
    issues.push({ path: 'description', message: 'Must not be empty' });
  } else if (command.description.trim().length > MAX_EXPENSE_DESCRIPTION_LENGTH) {
    issues.push({
      path: 'description',
      message: `Must be at most ${MAX_EXPENSE_DESCRIPTION_LENGTH} characters`,
    });
  }

  if (
    !Number.isInteger(command.amountMinorUnits) ||
    command.amountMinorUnits <= 0 ||
    command.amountMinorUnits > MAX_MONEY_MINOR_UNITS
  ) {
    issues.push({
      path: 'amountMinorUnits',
      message: `Must be a positive integer of at most ${MAX_MONEY_MINOR_UNITS}`,
    });
  }

  if (!/^[A-Z]{3}$/.test(command.currency)) {
    issues.push({ path: 'currency', message: 'Must be a three-letter uppercase currency code' });
  }

  if (issues.length > 0) {
    throw new ValidationError('Invalid expense request', issues);
  }
}
