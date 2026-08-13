/**
 * @nexora/application-workspaces — InstallAppHandler.
 *
 * The application entry point for marketplace installs: delegates to the
 * {@link WorkspaceApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { InstallAppCommand, InstallAppResult } from '../commands/install-app.command.js';
import type { CommandHandler } from '../commands/command-handler.js';
import type { WorkspaceApplicationService } from '../services/workspace-application-service.js';

/** Handles {@link InstallAppCommand}. */
export class InstallAppHandler implements CommandHandler<
  InstallAppCommand,
  InstallAppResult,
  NexoraError
> {
  readonly #service: WorkspaceApplicationService;

  constructor(service: WorkspaceApplicationService) {
    this.#service = service;
  }

  handle(command: InstallAppCommand): Promise<Result<InstallAppResult, NexoraError>> {
    return this.#service.installApp(command);
  }
}
