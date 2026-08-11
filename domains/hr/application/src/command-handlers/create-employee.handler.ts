/**
 * @nexora/application-hr — CreateEmployeeHandler.
 *
 * The application entry point for employee creation: delegates to the
 * {@link EmployeeApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  CreateEmployeeCommand,
  CreateEmployeeResult,
} from '../commands/create-employee.command.js';
import type { CommandHandler } from '../commands/command-handler.js';
import type { EmployeeApplicationService } from '../services/employee-application-service.js';

/** Handles {@link CreateEmployeeCommand}. */
export class CreateEmployeeHandler implements CommandHandler<
  CreateEmployeeCommand,
  CreateEmployeeResult,
  NexoraError
> {
  readonly #service: EmployeeApplicationService;

  constructor(service: EmployeeApplicationService) {
    this.#service = service;
  }

  handle(command: CreateEmployeeCommand): Promise<Result<CreateEmployeeResult, NexoraError>> {
    return this.#service.createEmployee(command);
  }
}
