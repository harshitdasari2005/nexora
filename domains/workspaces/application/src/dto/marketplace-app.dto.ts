/**
 * @nexora/application-workspaces — marketplace app DTO.
 *
 * The public marketplace listing representation: the catalog manifest plus
 * the requesting workspace's installed state. Internal aggregates and
 * manifest internals never cross module boundaries.
 */

import type { PluginManifest } from '@nexora/contracts/plugin';

/** The public marketplace listing for one app. */
export interface MarketplaceAppDto {
  /** The catalog app id, e.g. `com.nexora.hr`. */
  id: string;
  /** The display name. */
  name: string;
  /** The catalog (latest) version. */
  version: string;
  /** The marketplace summary. */
  summary: string;
  /** The marketplace description. */
  description: string;
  /** The publisher name. */
  publisher: string;
  /** The category tags. */
  categories: readonly string[];
  /** The scopes the app requires to function (the permission review). */
  requiredPermissions: readonly string[];
  /** The scopes the app is granted while active. */
  grantedPermissions: readonly string[];
  /** Whether the requesting workspace has this app installed. */
  installed: boolean;
  /** The installed version, when installed. */
  installedVersion?: string;
  /** The navigation label registered by the app (shell sidebar). */
  navigationLabel?: string;
}

/** Maps a catalog manifest plus installed state to its {@link MarketplaceAppDto}. */
export function toMarketplaceAppDto(
  manifest: PluginManifest,
  installedVersion: string | undefined,
): MarketplaceAppDto {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    summary: manifest.marketplace?.summary ?? manifest.name,
    description: manifest.marketplace?.description ?? '',
    publisher: manifest.marketplace?.publisher ?? '',
    categories: manifest.marketplace?.categories ?? [],
    requiredPermissions: [...manifest.permissions.required],
    grantedPermissions: [...manifest.permissions.granted],
    installed: installedVersion !== undefined,
    installedVersion,
    navigationLabel: manifest.navigation?.[0]?.label,
  };
}
