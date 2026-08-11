/**
 * @nexora/application-identity — EndSessionHandler.
 *
 * The application entry point for logout: delegates to the
 * {@link IdentityApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { SessionCommandResult } from '@nexora/domain-identity';

import type { EndSessionCommand } from '../commands/end-session.command.js';
import type { CommandHandler } from '../commands/command-handler.js';
import type { IdentityApplicationService } from '../services/identity-application-service.js';

/** Handles {@link EndSessionCommand}. */
export class EndSessionHandler implements CommandHandler<
  EndSessionCommand,
  SessionCommandResult,
  NexoraError
> {
  readonly #service: IdentityApplicationService;

  constructor(service: IdentityApplicationService) {
    this.#service = service;
  }

  handle(command: EndSessionCommand): Promise<Result<SessionCommandResult, NexoraError>> {
    return this.#service.endSession(command);
  }
}
