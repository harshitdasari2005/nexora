/**
 * @nexora/application-workspaces — CreateWorkspace validator.
 *
 * Structural validation of the create-workspace command before the use case
 * runs. Deep domain validation (slug shape within the organization, type)
 * remains the responsibility of the domain layer — this validator only
 * rejects malformed command input early (API_CONTRACTS.md §10 errors).
 */

import { ValidationError, type FieldIssue } from '@nexora/shared/errors';
import { WORKSPACE_TYPES } from '@nexora/domain-workspaces';

import type { CreateWorkspaceCommand } from '../commands/create-workspace.command.js';

/**
 * Validates a {@link CreateWorkspaceCommand}.
 *
 * @throws {ValidationError} when the command is malformed.
 */
export function validateCreateWorkspace(command: CreateWorkspaceCommand): void {
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

  if (!WORKSPACE_TYPES.includes(command.type as (typeof WORKSPACE_TYPES)[number])) {
    issues.push({
      path: 'type',
      message: `Must be one of: ${WORKSPACE_TYPES.join(', ')}`,
    });
  }

  if (issues.length > 0) {
    throw new ValidationError('Invalid workspace request', issues);
  }
}
