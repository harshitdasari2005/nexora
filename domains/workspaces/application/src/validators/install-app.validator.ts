/**
 * @nexora/application-workspaces — InstallApp validator.
 *
 * Structural validation of the install-app command before the use case runs.
 * The permission-review confirmation is validated here at the structural
 * level (must be a real `true`); the semantic gate (the app's declared
 * scopes) is enforced by the application service against the catalog.
 */

import { ValidationError, type FieldIssue } from '@nexora/shared/errors';

import type { InstallAppCommand } from '../commands/install-app.command.js';

/**
 * Validates an {@link InstallAppCommand}.
 *
 * Structural validation only: `permissionsConfirmed` must be a boolean (a
 * missing or non-boolean field is malformed). The SEMANTIC gate — the caller
 * must have actually confirmed the app's declared scopes — is enforced by
 * the application service against the catalog
 * ({@link PermissionReviewRequiredError}), never by the shape validator.
 *
 * @throws {ValidationError} when the command is malformed.
 */
export function validateInstallApp(command: InstallAppCommand): void {
  const issues: FieldIssue[] = [];

  if (command.appId.trim().length === 0) {
    issues.push({ path: 'appId', message: 'Must not be empty' });
  }

  if (typeof command.permissionsConfirmed !== 'boolean') {
    issues.push({
      path: 'permissionsConfirmed',
      message: 'Must be a boolean: the install-time permission review confirmation',
    });
  }

  if (issues.length > 0) {
    throw new ValidationError('Invalid app install request', issues);
  }
}
