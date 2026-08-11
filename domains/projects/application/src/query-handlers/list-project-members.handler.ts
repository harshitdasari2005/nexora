/**
 * @nexora/application-projects — ListProjectMembersHandler.
 *
 * The application entry point for the tenant-scoped project member listing
 * query.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  ListProjectMembersQuery,
  ListProjectMembersResult,
} from '../queries/list-project-members.query.js';
import type { ProjectApplicationService } from '../services/project-application-service.js';

/** Handles {@link ListProjectMembersQuery}. */
export class ListProjectMembersHandler {
  readonly #service: ProjectApplicationService;

  constructor(service: ProjectApplicationService) {
    this.#service = service;
  }

  handle(query: ListProjectMembersQuery): Promise<Result<ListProjectMembersResult, NexoraError>> {
    return this.#service.listProjectMembers(query.organizationId, query.projectId);
  }
}
