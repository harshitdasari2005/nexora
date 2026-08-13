/**
 * @nexora/application-workspaces — UninstallAppHandler.
 *
 * The application entry point for marketplace uninstalls: delegates to the
 * {@link WorkspaceApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { UninstallAppCommand, UninstallAppResult } from '../commands/uninstall-app.command.js';
import type { CommandHandler } from '../commands/command-handler.js';
import type { WorkspaceApplicationService } from '../services/workspace-application-service.js';

/** Handles {@link UninstallAppCommand}. */
export class UninstallAppHandler implements CommandHandler<
  UninstallAppCommand,
  UninstallAppResult,
  NexoraError
> {
  readonly #service: WorkspaceApplicationService;

  constructor(service: WorkspaceApplicationService) {
    this.#service = service;
  }

  handle(command: UninstallAppCommand): Promise<Result<UninstallAppResult, NexoraError>> {
    return this.#service.uninstallApp(command);
  }
}
