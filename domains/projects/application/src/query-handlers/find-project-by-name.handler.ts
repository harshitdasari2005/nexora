/**
 * @nexora/application-projects — FindProjectByNameHandler.
 *
 * The application entry point for the tenant-scoped project resolution
 * query.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  FindProjectByNameQuery,
  FindProjectByNameResult,
} from '../queries/find-project-by-name.query.js';
import type { ProjectApplicationService } from '../services/project-application-service.js';

/** Handles {@link FindProjectByNameQuery}. */
export class FindProjectByNameHandler {
  readonly #service: ProjectApplicationService;

  constructor(service: ProjectApplicationService) {
    this.#service = service;
  }

  handle(query: FindProjectByNameQuery): Promise<Result<FindProjectByNameResult, NexoraError>> {
    return this.#service.findProjectByName(query.organizationId, query.name);
  }
}
