/**
 * @nexora/application-identity — AuthenticateWithOidcHandler.
 *
 * The application entry point for OIDC authentication: validates the command
 * and delegates to the {@link IdentityApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  AuthenticateResult,
  AuthenticateWithOidcCommand,
} from '../commands/authenticate-with-oidc.command.js';
import type { CommandHandler } from '../commands/command-handler.js';
import type { IdentityApplicationService } from '../services/identity-application-service.js';

/** Handles {@link AuthenticateWithOidcCommand}. */
export class AuthenticateWithOidcHandler implements CommandHandler<
  AuthenticateWithOidcCommand,
  AuthenticateResult,
  NexoraError
> {
  readonly #service: IdentityApplicationService;

  constructor(service: IdentityApplicationService) {
    this.#service = service;
  }

  handle(command: AuthenticateWithOidcCommand): Promise<Result<AuthenticateResult, NexoraError>> {
    return this.#service.authenticateWithOidc(command);
  }
}
