/**
 * @nexora/application-workspaces — installed app DTO.
 *
 * The public "My Apps" representation: a workspace installation joined with
 * the catalog app identity.
 */

import type { WorkspaceInstallation } from '@nexora/domain-workspaces';

import type { AppCatalog } from '../marketplace/app-catalog.js';

/** A workspace-installed app as seen by the client. */
export interface InstalledAppDto {
  /** The installation record id. */
  installationId: string;
  /** The app id, e.g. `com.nexora.hr`. */
  appId: string;
  /** The app display name (from the catalog). */
  name: string;
  /** The installed version. */
  version: string;
  /** The catalog's current version (whether an update is available). */
  latestVersion: string;
  /** Whether a newer catalog version exists. */
  updateAvailable: boolean;
  /** ISO-8601 UTC install time. */
  installedAt: string;
}

/** Maps a workspace installation to its {@link InstalledAppDto}. */
export function toInstalledAppDto(
  installation: WorkspaceInstallation,
  catalog: AppCatalog,
): InstalledAppDto {
  const app = catalog.resolve(installation.pluginId);
  const latestVersion = app?.version ?? installation.pluginVersion;
  return {
    installationId: installation.id,
    appId: installation.pluginId,
    name: app?.name ?? installation.pluginId,
    version: installation.pluginVersion,
    latestVersion,
    updateAvailable: latestVersion !== installation.pluginVersion,
    installedAt: installation.installedAt,
  };
}
