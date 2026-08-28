/**
 * @nexora/application-finance — CreateBudget / ReviseBudget validator.
 *
 * Structural validation of budget command input before the use case runs.
 * Deep domain validation (name VO, money VO, period VO) remains the
 * responsibility of the domain layer — this validator only rejects
 * malformed command input early (API_CONTRACTS.md §10 errors).
 */

import { ValidationError, type FieldIssue } from '@nexora/shared/errors';

/** Maximum budget-name length accepted by the API (mirrors the domain). */
export const MAX_BUDGET_NAME_LENGTH = 120;

/** The maximum allocated/claimed amount accepted (mirrors the Money VO bound). */
export const MAX_MONEY_MINOR_UNITS = 1_000_000_000_00;

/** Shared shape validated by both create and revise. */
export interface BudgetFields {
  name: string;
  allocatedMinorUnits: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
}

/**
 * Validates budget command fields.
 *
 * @throws {ValidationError} when the command is malformed.
 */
export function validateBudgetFields(command: BudgetFields): void {
  const issues: FieldIssue[] = [];

  if (command.name.trim().length === 0) {
    issues.push({ path: 'name', message: 'Must not be empty' });
  } else if (command.name.trim().length > MAX_BUDGET_NAME_LENGTH) {
    issues.push({ path: 'name', message: `Must be at most ${MAX_BUDGET_NAME_LENGTH} characters` });
  }

  if (
    !Number.isInteger(command.allocatedMinorUnits) ||
    command.allocatedMinorUnits < 0 ||
    command.allocatedMinorUnits > MAX_MONEY_MINOR_UNITS
  ) {
    issues.push({
      path: 'allocatedMinorUnits',
      message: `Must be a non-negative integer of at most ${MAX_MONEY_MINOR_UNITS}`,
    });
  }

  if (!/^[A-Z]{3}$/.test(command.currency)) {
    issues.push({ path: 'currency', message: 'Must be a three-letter uppercase currency code' });
  }

  if (issues.length > 0) {
    throw new ValidationError('Invalid budget request', issues);
  }
}
