/**
 * @nexora/application-projects — ListProjectsHandler.
 *
 * The application entry point for the tenant-scoped project listing query.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { ListProjectsQuery, ListProjectsResult } from '../queries/list-projects.query.js';
import type { ProjectApplicationService } from '../services/project-application-service.js';

/** Handles {@link ListProjectsQuery}. */
export class ListProjectsHandler {
  readonly #service: ProjectApplicationService;

  constructor(service: ProjectApplicationService) {
    this.#service = service;
  }

  handle(query: ListProjectsQuery): Promise<Result<ListProjectsResult, NexoraError>> {
    return this.#service.listProjectsByOrganization(query.organizationId);
  }
}
