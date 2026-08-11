/**
 * @nexora/application-projects — CreateProject validator.
 *
 * Structural validation of the create-project command before the use case
 * runs. Deep domain validation (name VO, description bound) remains the
 * responsibility of the domain layer — this validator only rejects
 * malformed command input early (API_CONTRACTS.md §10 errors).
 */

import { ValidationError, type FieldIssue } from '@nexora/shared/errors';

import type { CreateProjectCommand } from '../commands/create-project.command.js';

/** Maximum project name length accepted by the API (mirrors the AI tool). */
export const MAX_PROJECT_NAME_LENGTH = 80;

/** Maximum project description length accepted by the API. */
export const MAX_PROJECT_DESCRIPTION_LENGTH = 2000;

/**
 * Validates a {@link CreateProjectCommand}.
 *
 * @throws {ValidationError} when the command is malformed.
 */
export function validateCreateProject(command: CreateProjectCommand): void {
  const issues: FieldIssue[] = [];

  if (command.name.trim().length === 0) {
    issues.push({ path: 'name', message: 'Must not be empty' });
  } else if (command.name.trim().length > MAX_PROJECT_NAME_LENGTH) {
    issues.push({ path: 'name', message: `Must be at most ${MAX_PROJECT_NAME_LENGTH} characters` });
  }

  const description = command.description?.trim();
  if (
    description !== undefined &&
    description.length > 0 &&
    description.length > MAX_PROJECT_DESCRIPTION_LENGTH
  ) {
    issues.push({
      path: 'description',
      message: `Must be at most ${MAX_PROJECT_DESCRIPTION_LENGTH} characters`,
    });
  }

  if (issues.length > 0) {
    throw new ValidationError('Invalid project request', issues);
  }
}
