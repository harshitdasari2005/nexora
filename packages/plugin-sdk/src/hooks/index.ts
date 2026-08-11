/**
 * @nexora/plugin-sdk — hooks.
 *
 * Plugin lifecycle hooks (SAD.md §7.4): the extension points the installer
 * invokes at each lifecycle transition. Hooks are public, overridable
 * methods on {@link BasePlugin}; this module defines the contract so
 * installers and tests depend on the interface, not the class.
 */

import type { PluginConfiguration } from '../configuration/index.js';
import type { PluginId } from '../types/index.js';

/** The context passed to every plugin lifecycle hook. */
export interface PluginHookContext {
  /** The plugin id. */
  pluginId: PluginId;
  /** The plugin's typed configuration store. */
  configuration: PluginConfiguration;
  /** ISO-8601 UTC time the hook ran. */
  timestamp: string;
}

/** The plugin lifecycle hooks, in invocation order. */
export interface PluginHooks {
  /**
   * Invoked after the plugin manifest validates and the plugin is registered
   * (install-time setup). Runs before `onEnable`.
   */
  onInstall(context: PluginHookContext): Promise<void> | void;
  /** Invoked when the plugin transitions to enabled. */
  onEnable(context: PluginHookContext): Promise<void> | void;
  /** Invoked when the plugin transitions to disabled. */
  onDisable(context: PluginHookContext): Promise<void> | void;
  /**
   * Invoked after a plugin upgrade (version change) while the plugin is in
   * the `updating` state; the previous version is provided.
   */
  onUpdate(context: PluginHookContext, previousVersion: string): Promise<void> | void;
  /**
   * Invoked before the plugin is uninstalled (teardown). Runs before the
   * registry entry is removed.
   */
  onUninstall(context: PluginHookContext): Promise<void> | void;
}
