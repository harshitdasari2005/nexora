/**
 * @nexora/application-hr — FindEmployeeByNameHandler.
 *
 * The application entry point for the tenant-scoped employee resolution
 * query.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  FindEmployeeByNameQuery,
  FindEmployeeByNameResult,
} from '../queries/find-employee-by-name.query.js';
import type { EmployeeApplicationService } from '../services/employee-application-service.js';

/** Handles {@link FindEmployeeByNameQuery}. */
export class FindEmployeeByNameHandler {
  readonly #service: EmployeeApplicationService;

  constructor(service: EmployeeApplicationService) {
    this.#service = service;
  }

  handle(query: FindEmployeeByNameQuery): Promise<Result<FindEmployeeByNameResult, NexoraError>> {
    return this.#service.findEmployeeByName(query.organizationId, query.name);
  }
}
