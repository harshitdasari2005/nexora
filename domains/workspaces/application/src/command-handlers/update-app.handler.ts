/**
 * @nexora/application-workspaces — UpdateAppHandler.
 *
 * The application entry point for marketplace updates: delegates to the
 * {@link WorkspaceApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { UpdateAppCommand, UpdateAppResult } from '../commands/update-app.command.js';
import type { CommandHandler } from '../commands/command-handler.js';
import type { WorkspaceApplicationService } from '../services/workspace-application-service.js';

/** Handles {@link UpdateAppCommand}. */
export class UpdateAppHandler implements CommandHandler<
  UpdateAppCommand,
  UpdateAppResult,
  NexoraError
> {
  readonly #service: WorkspaceApplicationService;

  constructor(service: WorkspaceApplicationService) {
    this.#service = service;
  }

  handle(command: UpdateAppCommand): Promise<Result<UpdateAppResult, NexoraError>> {
    return this.#service.updateApp(command);
  }
}
