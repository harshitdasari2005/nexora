/**
 * @nexora/plugin-sdk — manifest.
 *
 * The plugin manifest vocabulary (SAD.md §7.2). The **canonical**
 * `PluginManifest` — the single install contract — lives in
 * `@nexora/contracts/plugin` and is re-exported here, never redefined. This
 * module adds the SDK-side descriptive `PluginMetadata` and the extended
 * `SdkPluginManifest` that plugins author (the SDK strips SDK-only fields
 * when producing the canonical manifest for the registry).
 */

import type {
  PluginManifest,
  PluginCapability,
  PluginPermissionDeclaration,
  PluginEventRegistration,
  PluginNavigationRegistration,
  PluginDependency,
  PluginCompatibility,
  MarketplaceMetadata,
  PluginLifecycleState,
} from '@nexora/contracts/plugin';
import { PLUGIN_LIFECYCLE_STATES } from '@nexora/contracts/plugin';

export type {
  PluginManifest,
  PluginCapability,
  PluginPermissionDeclaration,
  PluginEventRegistration,
  PluginNavigationRegistration,
  PluginDependency,
  PluginCompatibility,
  MarketplaceMetadata,
  PluginLifecycleState,
};
export { PLUGIN_LIFECYCLE_STATES };

import type { ConfigurationDefaults } from '../configuration/index.js';

/**
 * Descriptive plugin metadata (authoring/publishing, not the install
 * contract). Lives alongside the canonical manifest; the marketplace uses
 * the canonical `MarketplaceMetadata` for listing data.
 */
export interface PluginMetadata {
  /** Author or authoring organization. */
  author: string;
  /** SPDX license id, e.g. `Apache-2.0`. */
  license: string;
  /** Short description of what the plugin does. */
  description: string;
  /** Optional project homepage. */
  homepage?: string;
  /** Optional search keywords. */
  keywords?: readonly string[];
}

/**
 * A plugin feature flag: a named capability toggle the platform may switch
 * per workspace without a plugin update.
 */
export interface PluginFeatureFlag {
  /** Flag name, e.g. `beta.auto_archive`. */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Whether the flag is on by default. */
  defaultEnabled: boolean;
}

/** Plugin settings: the typed defaults backing the plugin's configuration. */
export type PluginSettings = ConfigurationDefaults;

/**
 * The manifest a plugin author writes: the canonical `PluginManifest` plus
 * SDK-side metadata, settings, and feature flags. Producing the canonical
 * manifest for validation and the registry drops nothing — every canonical
 * field is preserved; the SDK-side fields are carried alongside.
 */
export interface SdkPluginManifest {
  /** The canonical install contract. */
  manifest: PluginManifest;
  /** Descriptive metadata (author, license, ...). */
  metadata?: PluginMetadata;
  /** Default settings seeded into the plugin configuration store. */
  settings?: PluginSettings;
  /** Feature flags the plugin exposes to the platform. */
  featureFlags?: readonly PluginFeatureFlag[];
}

/**
 * Derives the canonical `PluginManifest` from an authored manifest. This is
 * an identity function for the canonical fields — it exists so consumers
 * always receive the contract shape.
 */
export function toCanonicalManifest(authored: SdkPluginManifest): PluginManifest {
  return authored.manifest;
}
