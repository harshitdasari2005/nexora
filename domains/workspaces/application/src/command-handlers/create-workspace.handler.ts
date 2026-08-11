/**
 * @nexora/application-workspaces — CreateWorkspaceHandler.
 *
 * The application entry point for workspace creation: delegates to the
 * {@link WorkspaceApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  CreateWorkspaceCommand,
  CreateWorkspaceResult,
} from '../commands/create-workspace.command.js';
import type { CommandHandler } from '../commands/command-handler.js';
import type { WorkspaceApplicationService } from '../services/workspace-application-service.js';

/** Handles {@link CreateWorkspaceCommand}. */
export class CreateWorkspaceHandler implements CommandHandler<
  CreateWorkspaceCommand,
  CreateWorkspaceResult,
  NexoraError
> {
  readonly #service: WorkspaceApplicationService;

  constructor(service: WorkspaceApplicationService) {
    this.#service = service;
  }

  handle(command: CreateWorkspaceCommand): Promise<Result<CreateWorkspaceResult, NexoraError>> {
    return this.#service.createWorkspace(command);
  }
}
