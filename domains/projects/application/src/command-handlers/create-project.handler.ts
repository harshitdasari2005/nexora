/**
 * @nexora/application-projects — CreateProjectHandler.
 *
 * The application entry point for project creation: delegates to the
 * {@link ProjectApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  CreateProjectCommand,
  CreateProjectResult,
} from '../commands/create-project.command.js';
import type { CommandHandler } from '../commands/command-handler.js';
import type { ProjectApplicationService } from '../services/project-application-service.js';

/** Handles {@link CreateProjectCommand}. */
export class CreateProjectHandler implements CommandHandler<
  CreateProjectCommand,
  CreateProjectResult,
  NexoraError
> {
  readonly #service: ProjectApplicationService;

  constructor(service: ProjectApplicationService) {
    this.#service = service;
  }

  handle(command: CreateProjectCommand): Promise<Result<CreateProjectResult, NexoraError>> {
    return this.#service.createProject(command);
  }
}
