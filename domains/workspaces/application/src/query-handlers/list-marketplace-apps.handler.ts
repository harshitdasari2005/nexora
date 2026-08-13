/**
 * @nexora/application-workspaces — ListMarketplaceAppsHandler.
 *
 * Resolves the marketplace catalog with installed state via the
 * {@link WorkspaceApplicationService}.
 */

import type { Result } from '@nexora/shared/result';

import type {
  ListMarketplaceAppsError,
  ListMarketplaceAppsQuery,
  ListMarketplaceAppsResult,
} from '../queries/list-marketplace-apps.query.js';
import type { WorkspaceApplicationService } from '../services/workspace-application-service.js';

/** Handles {@link ListMarketplaceAppsQuery}. */
export class ListMarketplaceAppsHandler {
  readonly #service: WorkspaceApplicationService;

  constructor(service: WorkspaceApplicationService) {
    this.#service = service;
  }

  handle(
    query: ListMarketplaceAppsQuery,
  ): Promise<Result<ListMarketplaceAppsResult, ListMarketplaceAppsError>> {
    return this.#service.listMarketplaceApps(query.workspaceId);
  }
}
