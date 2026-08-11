/**
 * @nexora/plugin-sdk — loader.
 *
 * Plugin loading contracts (SAD.md §7.3): how a plugin module is loaded
 * from a location into a {@link PluginFactory}. The platform implements the
 * actual loading strategy (dynamic import, sandbox, worker); the SDK defines
 * the contract and the module shape.
 */

import type { PluginFactory } from '../registry/index.js';
import type { PluginId } from '../types/index.js';

/** The exported surface of a plugin module. */
export interface PluginModule {
  /** The default export: a factory producing the plugin instance. */
  default: PluginFactory;
  /** Optional stable module id (for integrity checks). */
  id?: PluginId;
}

/** Options for loading a plugin. */
export interface LoadOptions {
  /** The plugin id expected at the location (integrity check). */
  expectedId?: PluginId;
  /** Expected semantic version (integrity check). */
  expectedVersion?: string;
  /** Whether to verify the module's integrity (hash). */
  verifyIntegrity?: boolean;
}

/** The result of loading a plugin module. */
export interface LoadedPlugin {
  /** The plugin module. */
  module: PluginModule;
  /** The plugin id (module id or expected id). */
  id: PluginId;
  /** ISO-8601 UTC time the plugin was loaded. */
  loadedAt: string;
}

/** The plugin loader contract. The platform implements it. */
export interface PluginLoader {
  /** The loader name, for observability. */
  readonly name: string;
  /** Loads a plugin module from a location. */
  load(location: string, options?: LoadOptions): Promise<LoadedPlugin>;
}
