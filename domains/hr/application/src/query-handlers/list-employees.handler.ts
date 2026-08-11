/**
 * @nexora/application-hr — employee listing handlers.
 *
 * The application entry points for the tenant-scoped employee read queries
 * (by-id lookup and full organization listing).
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  ListEmployeesByIdsQuery,
  ListEmployeesByIdsResult,
  ListEmployeesQuery,
  ListEmployeesResult,
} from '../queries/list-employees.query.js';
import type { EmployeeApplicationService } from '../services/employee-application-service.js';

/** Handles {@link ListEmployeesByIdsQuery}. */
export class ListEmployeesByIdsHandler {
  readonly #service: EmployeeApplicationService;

  constructor(service: EmployeeApplicationService) {
    this.#service = service;
  }

  handle(query: ListEmployeesByIdsQuery): Promise<Result<ListEmployeesByIdsResult, NexoraError>> {
    return this.#service.listEmployeesByIds(query.organizationId, query.ids);
  }
}

/** Handles {@link ListEmployeesQuery}. */
export class ListEmployeesHandler {
  readonly #service: EmployeeApplicationService;

  constructor(service: EmployeeApplicationService) {
    this.#service = service;
  }

  handle(query: ListEmployeesQuery): Promise<Result<ListEmployeesResult, NexoraError>> {
    return this.#service.listEmployeesByOrganization(query.organizationId);
  }
}
