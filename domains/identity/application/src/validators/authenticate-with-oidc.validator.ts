/**
 * @nexora/application-identity — AuthenticateWithOidc validator.
 *
 * Structural validation of the OIDC authentication command before the use
 * case runs. Deep domain validation (email shape, uniqueness, password
 * policy) remains the responsibility of the domain layer — this validator
 * only rejects malformed command input early (API_CONTRACTS.md §10 errors).
 */

import { ValidationError, type FieldIssue } from '@nexora/shared/errors';

import type { AuthenticateWithOidcCommand } from '../commands/authenticate-with-oidc.command.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates an {@link AuthenticateWithOidcCommand}.
 *
 * @throws {ValidationError} when the command is malformed.
 */
export function validateAuthenticateWithOidc(command: AuthenticateWithOidcCommand): void {
  const issues: FieldIssue[] = [];

  if (command.oidcSubject.trim().length === 0) {
    issues.push({ path: 'oidcSubject', message: 'Must not be empty' });
  }
  const email = command.email.trim();
  if (email.length === 0) {
    issues.push({ path: 'email', message: 'Must not be empty' });
  } else if (!EMAIL_PATTERN.test(email)) {
    issues.push({ path: 'email', message: 'Must be a valid email address' });
  }
  if (command.emailVerified !== true) {
    issues.push({
      path: 'emailVerified',
      message: 'The identity provider must verify the email before authentication',
    });
  }
  if (command.issuer.trim().length === 0) {
    issues.push({ path: 'issuer', message: 'Must not be empty' });
  }
  if (command.correlationId.trim().length === 0) {
    issues.push({ path: 'correlationId', message: 'Must not be empty' });
  }

  if (issues.length > 0) {
    throw new ValidationError('Invalid authentication request', issues);
  }
}
