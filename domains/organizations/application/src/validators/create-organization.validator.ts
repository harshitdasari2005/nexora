/**
 * @nexora/application-organizations — CreateOrganization validator.
 *
 * Structural validation of the create-organization command before the use
 * case runs. Deep domain validation (slug shape, uniqueness, type) remains
 * the responsibility of the domain layer — this validator only rejects
 * malformed command input early (API_CONTRACTS.md §10 errors).
 */

import { ValidationError, type FieldIssue } from '@nexora/shared/errors';
import { ORGANIZATION_TYPES } from '@nexora/domain-organizations';

import type { CreateOrganizationCommand } from '../commands/create-organization.command.js';

/**
 * Validates a {@link CreateOrganizationCommand}.
 *
 * @throws {ValidationError} when the command is malformed.
 */
export function validateCreateOrganization(command: CreateOrganizationCommand): void {
  const issues: FieldIssue[] = [];

  if (command.name.trim().length === 0) {
    issues.push({ path: 'name', message: 'Must not be empty' });
  } else if (command.name.trim().length > 80) {
    issues.push({ path: 'name', message: 'Must be at most 80 characters' });
  }

  const slug = command.slug.trim().toLowerCase();
  if (slug.length === 0) {
    issues.push({ path: 'slug', message: 'Must not be empty' });
  } else if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    issues.push({
      path: 'slug',
      message: 'Must be lowercase letters, digits, and hyphens (2–63 characters)',
    });
  }

  if (!ORGANIZATION_TYPES.includes(command.type as (typeof ORGANIZATION_TYPES)[number])) {
    issues.push({
      path: 'type',
      message: `Must be one of: ${ORGANIZATION_TYPES.join(', ')}`,
    });
  }

  if (issues.length > 0) {
    throw new ValidationError('Invalid organization request', issues);
  }
}
