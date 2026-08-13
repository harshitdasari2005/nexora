/**
 * @nexora/application-workspaces — ListInstalledAppsHandler.
 *
 * Resolves the apps installed in a workspace via the
 * {@link WorkspaceApplicationService}.
 */

import type { Result } from '@nexora/shared/result';

import type {
  ListInstalledAppsError,
  ListInstalledAppsQuery,
  ListInstalledAppsResult,
} from '../queries/list-installed-apps.query.js';
import type { WorkspaceApplicationService } from '../services/workspace-application-service.js';

/** Handles {@link ListInstalledAppsQuery}. */
export class ListInstalledAppsHandler {
  readonly #service: WorkspaceApplicationService;

  constructor(service: WorkspaceApplicationService) {
    this.#service = service;
  }

  handle(
    query: ListInstalledAppsQuery,
  ): Promise<Result<ListInstalledAppsResult, ListInstalledAppsError>> {
    return this.#service.listInstalledApps(query.workspaceId);
  }
}
