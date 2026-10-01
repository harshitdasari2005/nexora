/**
 * @nexora/application-hr — RevokeHireHandler.
 *
 * The application entry point for reverting a hire: delegates to the
 * {@link EmployeeApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { RevokeHireCommand, RevokeHireResult } from '../commands/revoke-hire.command.js';
import type { CommandHandler } from '../commands/command-handler.js';
import type { EmployeeApplicationService } from '../services/employee-application-service.js';

/** Handles {@link RevokeHireCommand}. */
export class RevokeHireHandler implements CommandHandler<
  RevokeHireCommand,
  RevokeHireResult,
  NexoraError
> {
  readonly #service: EmployeeApplicationService;

  constructor(service: EmployeeApplicationService) {
    this.#service = service;
  }

  handle(command: RevokeHireCommand): Promise<Result<RevokeHireResult, NexoraError>> {
    return this.#service.revokeHire(command);
  }
}
