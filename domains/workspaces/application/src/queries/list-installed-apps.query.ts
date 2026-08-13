/**
 * @nexora/application-workspaces — ListInstalledApps query.
 *
 * S19 marketplace read: the apps installed in a workspace (the "My Apps"
 * view) with their live versions and install times.
 */

import type { WorkspaceId } from '@nexora/contracts/common';
import type { WorkspaceNotFoundError } from '@nexora/domain-workspaces';

import type { InstalledAppDto } from '../dto/installed-app.dto.js';

/** Lists the apps installed in a workspace. */
export interface ListInstalledAppsQuery {
  /** The workspace to list. */
  workspaceId: WorkspaceId;
}

/** The result of {@link ListInstalledAppsQuery}. */
export type ListInstalledAppsResult = readonly InstalledAppDto[];

/** The error of {@link ListInstalledAppsQuery}. */
export type ListInstalledAppsError = WorkspaceNotFoundError;
