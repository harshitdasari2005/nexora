/**
 * @nexora/application-workspaces — ListWorkspacesHandler.
 *
 * Resolves the workspaces of an organization via the
 * {@link WorkspaceApplicationService}.
 */

import type { Result } from '@nexora/shared/result';

import type {
  ListWorkspacesQuery,
  ListWorkspacesResult,
} from '../queries/list-workspaces.query.js';
import type { WorkspaceApplicationService } from '../services/workspace-application-service.js';

/** Handles {@link ListWorkspacesQuery}. */
export class ListWorkspacesHandler {
  readonly #service: WorkspaceApplicationService;

  constructor(service: WorkspaceApplicationService) {
    this.#service = service;
  }

  handle(query: ListWorkspacesQuery): Promise<Result<ListWorkspacesResult, never>> {
    return this.#service.listWorkspacesByOrganization(query.organizationId);
  }
}
