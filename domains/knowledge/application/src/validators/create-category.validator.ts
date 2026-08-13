/**
 * @nexora/application-knowledge — CreateCategory validator.
 *
 * Validates the user-controlled category name BEFORE the domain is touched
 * (fail fast). Scope fields (tenant + workspace) arrive via the trusted
 * context and are never validated from user input.
 */

import { ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';

import type { CreateCategoryCommand } from '../commands/create-category.command.js';

/** The maximum category name length (mirrors the domain). */
export const CATEGORY_NAME_MAX_LENGTH = 100;

/** Validates a {@link CreateCategoryCommand}; throws {@link ValidationError}. */
export function validateCreateCategory(command: CreateCategoryCommand): void {
  const issues: FieldIssue[] = [];
  const name = command.name.trim();
  if (name.length === 0) {
    issues.push({ path: 'name', message: 'A name is required' });
  } else if (name.length > CATEGORY_NAME_MAX_LENGTH) {
    issues.push({
      path: 'name',
      message: `Name must be at most ${CATEGORY_NAME_MAX_LENGTH} characters`,
    });
  }
  if (issues.length > 0) {
    throw new ValidationError('Invalid knowledge category', issues);
  }
}
