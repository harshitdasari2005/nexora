/**
 * @nexora/contracts — plugin contracts.
 *
 * The plugin contract (SAD.md §7, PSD.md §7): manifest, lifecycle,
 * permissions, capabilities, dependencies, compatibility, and marketplace
 * metadata. First-party apps are plugins too (ADR-003), so these types are
 * the single installability contract (FR-16).
 */

import type { Scope } from '../identity/index.js';
import type { SemVer, Timestamp } from '../common/index.js';

/**
 * Plugin lifecycle states (SAD.md §7.3, DDD.md §14.8).
 */
export const PLUGIN_LIFECYCLE_STATES = [
  'registered',
  'validated',
  'installed',
  'active',
  'disabled',
  'uninstalled',
] as const;

/** Single plugin lifecycle state literal. */
export type PluginLifecycleState = (typeof PLUGIN_LIFECYCLE_STATES)[number];

/**
 * Plugin registry entry.
 */
export interface PluginDescriptor {
  /** Plugin id (the manifest `id`). */
  id: string;
  /** Display name. */
  name: string;
  /** Semantic version of the plugin. */
  version: SemVer;
  /** Lifecycle state. */
  state: PluginLifecycleState;
  /** ISO-8601 UTC time the plugin was installed. */
  installedAt?: Timestamp;
}

/**
 * A registered capability of a plugin (AIR.md §5 discovery surface).
 */
export interface PluginCapability {
  /** Capability id, e.g. `projects.create_project`. */
  id: string;
  /** Description for the AI planner. */
  description: string;
  /** Skill id implementing the capability. */
  skillId: string;
}

/**
 * A permission declaration: which scopes the plugin requires, and which it
 * grants when installed (install-time permission review, PRD.md §20.2).
 */
export interface PluginPermissionDeclaration {
  /** Required scopes to install/activate. */
  required: readonly Scope[];
  /** Scopes granted to the plugin while active. */
  granted: readonly Scope[];
}

/**
 * A registered event contract of a plugin.
 */
export interface PluginEventRegistration {
  /** Event types the plugin emits. */
  emits: readonly string[];
  /** Event types the plugin consumes. */
  subscribes: readonly string[];
}

/**
 * Navigation registration — plugin views appear inside the platform shell
 * (FRONTEND.md §7, SAD.md §6.3).
 */
export interface PluginNavigationRegistration {
  /** Root route id, e.g. `projects`. */
  id: string;
  /** Display label in the shell sidebar. */
  label: string;
  /** Optional icon token reference. */
  icon?: string;
}

/**
 * A declared plugin dependency (`id@range`, SAD.md §7.8 dependency
 * management).
 */
export interface PluginDependency {
  /** Plugin id depended on. */
  id: string;
  /** SemVer range, e.g. `^1.2.0`. */
  range: string;
}

/**
 * Compatibility contract: the platform API versions and plugin SDK versions
 * a plugin is compatible with (SAD.md §7.11 compatibility).
 */
export interface PluginCompatibility {
  /** Minimum platform API version required. */
  platformApiVersion: SemVer;
  /** Plugin SDK version the plugin was built against. */
  sdkVersion: SemVer;
  /** Runtime engine versions supported, when constrained. */
  engineVersions?: readonly SemVer[];
}

/**
 * Marketplace metadata (future Enterprise Marketplace, SAD.md §18).
 */
export interface MarketplaceMetadata {
  /** Publisher name, e.g. `Nexora`, `Acme Inc`. */
  publisher: string;
  /** Publisher id. */
  publisherId: string;
  /** Short marketing description. */
  summary: string;
  /** Long description (markdown). */
  description: string;
  /** Icon URL or token. */
  iconUrl?: string;
  /** Category tags, e.g. `hr`, `productivity`. */
  categories: readonly string[];
  /** Installation count (marketplace telemetry). */
  installCount: number;
}

/**
 * The plugin manifest — the single contract validated at install
 * (SAD.md §7.2, ENGINEERING_PLAYBOOK.md §6.2).
 */
export interface PluginManifest {
  /** Plugin id, reverse-DNS style, e.g. `com.nexora.projects`. */
  id: string;
  /** Plugin name. */
  name: string;
  /** Plugin semantic version. */
  version: SemVer;
  /** Plugin capability declarations. */
  capabilities: readonly PluginCapability[];
  /** Permission declarations. */
  permissions: PluginPermissionDeclaration;
  /** Event registrations. */
  events: PluginEventRegistration;
  /** Navigation registrations. */
  navigation?: readonly PluginNavigationRegistration[];
  /** Declared plugin dependencies. */
  dependencies?: readonly PluginDependency[];
  /** Compatibility contract. */
  compatibility: PluginCompatibility;
  /** Marketplace metadata, when published. */
  marketplace?: MarketplaceMetadata;
}
