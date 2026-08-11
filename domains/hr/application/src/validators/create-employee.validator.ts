/**
 * @nexora/application-hr — CreateEmployee validator.
 *
 * Structural validation of the create-employee command before the use case
 * runs. Deep domain validation (name VO) remains the responsibility of the
 * domain layer — this validator only rejects malformed command input early
 * (API_CONTRACTS.md §10 errors).
 */

import { ValidationError, type FieldIssue } from '@nexora/shared/errors';

import type { CreateEmployeeCommand } from '../commands/create-employee.command.js';

/** Maximum employee name length accepted by the API (mirrors the domain). */
export const MAX_EMPLOYEE_NAME_LENGTH = 120;

/**
 * Validates a {@link CreateEmployeeCommand}.
 *
 * @throws {ValidationError} when the command is malformed.
 */
export function validateCreateEmployee(command: CreateEmployeeCommand): void {
  const issues: FieldIssue[] = [];

  if (command.name.trim().length === 0) {
    issues.push({ path: 'name', message: 'Must not be empty' });
  } else if (command.name.trim().length > MAX_EMPLOYEE_NAME_LENGTH) {
    issues.push({
      path: 'name',
      message: `Must be at most ${MAX_EMPLOYEE_NAME_LENGTH} characters`,
    });
  }

  if (issues.length > 0) {
    throw new ValidationError('Invalid employee request', issues);
  }
}
