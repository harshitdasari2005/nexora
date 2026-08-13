/**
 * @nexora/application-workspaces — ListMarketplaceApps query.
 *
 * S19 marketplace browse: the catalog plus each app's installed state in the
 * requesting workspace (CQRS read side; BACKEND.md §8).
 */

import type { WorkspaceId } from '@nexora/contracts/common';
import type { WorkspaceNotFoundError } from '@nexora/domain-workspaces';

import type { MarketplaceAppDto } from '../dto/marketplace-app.dto.js';

/** Lists the marketplace catalog with per-workspace installed state. */
export interface ListMarketplaceAppsQuery {
  /** The workspace whose installed state is joined into the listing. */
  workspaceId: WorkspaceId;
}

/** The result of {@link ListMarketplaceAppsQuery}. */
export type ListMarketplaceAppsResult = readonly MarketplaceAppDto[];

/** The error of {@link ListMarketplaceAppsQuery}. */
export type ListMarketplaceAppsError = WorkspaceNotFoundError;
