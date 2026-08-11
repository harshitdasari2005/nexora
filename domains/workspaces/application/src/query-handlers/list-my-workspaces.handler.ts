/**
 * @nexora/application-workspaces — ListMyWorkspacesHandler.
 *
 * Resolves the workspaces a user is a member of via the
 * {@link WorkspaceApplicationService}. Authorization lives here — membership
 * is the rule; callers (routes, AI tools) supply only trusted identity.
 */

import type { Result } from '@nexora/shared/result';

import type {
  ListMyWorkspacesQuery,
  ListMyWorkspacesResult,
} from '../queries/list-my-workspaces.query.js';
import type { WorkspaceApplicationService } from '../services/workspace-application-service.js';

/** Handles {@link ListMyWorkspacesQuery}. */
export class ListMyWorkspacesHandler {
  readonly #service: WorkspaceApplicationService;

  constructor(service: WorkspaceApplicationService) {
    this.#service = service;
  }

  handle(query: ListMyWorkspacesQuery): Promise<Result<ListMyWorkspacesResult, never>> {
    return this.#service.listMyWorkspaces(query.userId, query.organizationId);
  }
}
