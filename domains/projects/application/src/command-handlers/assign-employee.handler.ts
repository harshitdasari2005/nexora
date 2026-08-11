/**
 * @nexora/application-projects — AssignEmployeeToProjectHandler.
 *
 * The application entry point for the employee→project assignment use case:
 * delegates to the {@link ProjectApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  AssignEmployeeToProjectCommand,
  AssignEmployeeToProjectResult,
} from '../commands/assign-employee.command.js';
import type { CommandHandler } from '../commands/command-handler.js';
import type { ProjectApplicationService } from '../services/project-application-service.js';

/** Handles {@link AssignEmployeeToProjectCommand}. */
export class AssignEmployeeToProjectHandler implements CommandHandler<
  AssignEmployeeToProjectCommand,
  AssignEmployeeToProjectResult,
  NexoraError
> {
  readonly #service: ProjectApplicationService;

  constructor(service: ProjectApplicationService) {
    this.#service = service;
  }

  handle(
    command: AssignEmployeeToProjectCommand,
  ): Promise<Result<AssignEmployeeToProjectResult, NexoraError>> {
    return this.#service.assignEmployeeToProject(command);
  }
}
