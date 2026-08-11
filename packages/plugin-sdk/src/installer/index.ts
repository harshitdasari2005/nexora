/**
 * @nexora/plugin-sdk — installer.
 *
 * The plugin installation orchestration (SAD.md §7.3-7.10): install,
 * enable, disable, upgrade, uninstall, and rollback. The installer enforces
 * validation, compatibility, and dependency resolution, drives the plugin
 * lifecycle, runs lifecycle hooks, and keeps the registry consistent. A
 * failed install never leaves a partial entry behind.
 */

import { createLogger, type Logger } from '@nexora/shared/logger';
import type { PluginManifest } from '@nexora/contracts/plugin';

import type { BasePlugin, PluginContext } from '../base/index.js';
import type { PluginHookContext } from '../hooks/index.js';
import {
  PluginInstallationError,
  PluginLifecycleError,
  PluginValidationError,
} from '../errors/index.js';
import { PLUGIN_SDK_VERSION } from '../types/index.js';
import type { PluginState } from '../lifecycle/index.js';
import type { PluginRegistry, PluginRegistryEntry } from '../registry/index.js';
import {
  CompatibilityValidator,
  DependencyValidator,
  ManifestValidator,
  PermissionValidator,
} from '../validators/index.js';

/** Options for installing a plugin. */
export interface InstallOptions {
  /** The plugin instance to install. */
  plugin: BasePlugin;
  /** Whether to enable the plugin immediately after install. Default true. */
  enableAfterInstall?: boolean;
}

/** Options for upgrading a plugin. */
export interface UpgradeOptions {
  /** The new plugin instance (built from the new manifest). */
  plugin: BasePlugin;
  /** The previous version (defaults to the registry entry's version). */
  previousVersion?: string;
}

/** The plugin installer contract. */
export interface PluginInstaller {
  /** Installs and (by default) enables a plugin. */
  install(options: InstallOptions): Promise<PluginRegistryEntry>;
  /** Enables an installed or disabled plugin. */
  enable(id: string): Promise<PluginRegistryEntry>;
  /** Disables an enabled plugin. */
  disable(id: string): Promise<PluginRegistryEntry>;
  /** Upgrades a plugin to a new instance/version. */
  upgrade(id: string, options: UpgradeOptions): Promise<PluginRegistryEntry>;
  /** Uninstalls a plugin (idempotent when already uninstalled). */
  uninstall(id: string): Promise<void>;
  /** Recovers a failed plugin to a stable state. */
  rollback(id: string): Promise<PluginRegistryEntry>;
}

/** Constructor options for {@link DefaultPluginInstaller}. */
export interface DefaultInstallerOptions {
  /** The registry entries are installed into. */
  registry: PluginRegistry;
  /** The running platform version (compatibility checks). */
  platformVersion?: string;
  /** The running Plugin SDK version (compatibility checks). */
  sdkVersion?: string;
  /** Optional logger. */
  logger?: Logger;
}

/**
 * The default installer: a self-contained, deterministic installation
 * pipeline built on the SDK contracts. The platform may replace it with a
 * distribution-aware installer (marketplace, sandboxing) — the contract is
 * what matters.
 */
export class DefaultPluginInstaller implements PluginInstaller {
  readonly #registry: PluginRegistry;
  readonly #platformVersion: string;
  readonly #sdkVersion: string;
  readonly #logger: Logger;
  readonly manifestValidator = new ManifestValidator();
  readonly dependencyValidator = new DependencyValidator();
  readonly compatibilityValidator = new CompatibilityValidator();
  readonly permissionValidator = new PermissionValidator();

  constructor(options: DefaultInstallerOptions) {
    this.#registry = options.registry;
    // Default to the SDK version so a default-constructed installer does not
    // silently reject every plugin; production MUST supply the real platform
    // version (compatibility is enforced against it).
    this.#platformVersion = options.platformVersion ?? PLUGIN_SDK_VERSION;
    this.#sdkVersion = options.sdkVersion ?? PLUGIN_SDK_VERSION;
    this.#logger = options.logger ?? createLogger({ service: 'plugin-installer' });
  }

  async install(options: InstallOptions): Promise<PluginRegistryEntry> {
    const plugin = options.plugin;
    const enableAfterInstall = options.enableAfterInstall ?? true;

    try {
      if (this.#registry.resolve(plugin.manifest.id) !== undefined) {
        throw new PluginInstallationError(`Plugin already installed: ${plugin.manifest.id}`);
      }
      this.#validateAll(plugin.manifest);
      this.dependencyValidator.resolve(plugin.manifest, this.#registry);

      plugin.lifecycle.transition('installed', 'install');
      const entry: PluginRegistryEntry = {
        plugin,
        descriptor: {
          id: plugin.manifest.id,
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          state: plugin.lifecycle.canonicalState,
          installedAt: new Date().toISOString(),
        },
        state: 'installed',
        registeredAt: new Date().toISOString(),
        installedAt: new Date().toISOString(),
      };
      this.#registry.register(entry);
      await plugin.onInstall(this.#hookContext(plugin));

      if (enableAfterInstall) {
        // `await` is required: a bare `return this.enable(...)` would let the
        // rejection bypass this try/catch (async return-promise semantics),
        // skipping failure containment.
        const enabled = await this.enable(plugin.manifest.id);
        return enabled;
      }
      this.#logger.info(`plugin installed: ${plugin.manifest.id}@${plugin.manifest.version}`);
      return entry;
    } catch (error) {
      await this.#failAndRollback(plugin);
      throw error;
    }
  }

  async enable(id: string): Promise<PluginRegistryEntry> {
    const entry = this.#requireEntry(id);
    const plugin = entry.plugin;
    try {
      plugin.lifecycle.transition('enabled', 'enable');
      plugin.setActivated();
      await plugin.activate(this.#pluginContext(plugin));
      await plugin.onEnable(this.#hookContext(plugin));
      this.#registry.updateState(id, 'enabled', { enabledAt: new Date().toISOString() });
      this.#logger.info(`plugin enabled: ${id}`);
      return this.#registry.resolve(id) as PluginRegistryEntry;
    } catch (error) {
      plugin.setDeactivated();
      await this.#fail(plugin, error);
      throw error;
    }
  }

  async disable(id: string): Promise<PluginRegistryEntry> {
    const entry = this.#requireEntry(id);
    const plugin = entry.plugin;
    try {
      plugin.lifecycle.transition('disabled', 'disable');
      plugin.setDeactivated();
      await plugin.deactivate();
      await plugin.onDisable(this.#hookContext(plugin));
      this.#registry.updateState(id, 'disabled');
      this.#logger.info(`plugin disabled: ${id}`);
      return this.#registry.resolve(id) as PluginRegistryEntry;
    } catch (error) {
      await this.#fail(plugin, error);
      throw error;
    }
  }

  async upgrade(id: string, options: UpgradeOptions): Promise<PluginRegistryEntry> {
    const entry = this.#requireEntry(id);
    const previousVersion = options.previousVersion ?? entry.descriptor.version;
    const next = options.plugin;

    // The new instance must carry the same plugin id (an upgrade replaces a
    // version, never the identity).
    if (next.manifest.id !== id) {
      throw new PluginLifecycleError(
        `Upgrade id mismatch: expected ${id}, got ${next.manifest.id}`,
      );
    }

    // Captured before the try so the failure path can restore the previous
    // entry's activation state.
    const wasEnabled = entry.state === 'enabled';

    try {
      this.#validateAll(next.manifest);
      this.dependencyValidator.resolve(next.manifest, this.#registry);

      if (wasEnabled) {
        entry.plugin.setDeactivated();
        await entry.plugin.deactivate();
      }

      next.lifecycle.transition('updating', 'upgrade');
      await next.onUpdate(this.#hookContext(next), previousVersion);

      // Swap the registry entry to the new instance BEFORE activation, so a
      // throwing activate marks the entry that actually holds the new plugin
      // (consistent failure bookkeeping + rollback).
      const installedAt = entry.installedAt ?? new Date().toISOString();
      this.#registry.unregister(id);
      this.#registry.register({
        plugin: next,
        descriptor: {
          id: next.manifest.id,
          name: next.manifest.name,
          version: next.manifest.version,
          state: next.lifecycle.canonicalState,
          installedAt,
        },
        state: 'updating',
        registeredAt: entry.registeredAt,
        installedAt,
      });

      const target: PluginState = wasEnabled ? 'enabled' : 'installed';
      next.lifecycle.transition(target, 'upgrade-complete');
      if (target === 'enabled') {
        next.setActivated();
        await next.activate(this.#pluginContext(next));
        await next.onEnable(this.#hookContext(next));
      }
      this.#registry.updateState(id, target, {
        enabledAt: target === 'enabled' ? new Date().toISOString() : undefined,
      });

      entry.plugin.lifecycle.transition('uninstalled', 'replaced by upgrade');
      this.#logger.info(`plugin upgraded: ${id} ${previousVersion} → ${next.manifest.version}`);
      return this.#registry.resolve(id) as PluginRegistryEntry;
    } catch (error) {
      // A failed upgrade must never strand the platform on the broken new
      // instance: restore the previous entry exactly as it was (and
      // re-activate it when it was enabled). The failed instance is marked
      // for observability but never registered.
      if (this.#registry.resolve(id)?.plugin === next) {
        this.#registry.unregister(id);
        this.#registry.register(entry);
        if (wasEnabled) {
          entry.plugin.setActivated();
          await entry.plugin.activate(this.#pluginContext(entry.plugin));
        }
        if (next.lifecycle.canTransition('failed')) {
          next.lifecycle.transition('failed', 'upgrade-failure');
        }
        this.#logger.warn(
          `upgrade failed; restored previous version ${id}@${entry.descriptor.version}`,
          error,
        );
      } else if (wasEnabled && this.#registry.resolve(id)?.plugin === entry.plugin) {
        // The failure happened before the swap (e.g. deactivate threw): the
        // old plugin may be half-deactivated. Mark it failed so the operator
        // can recover via rollback rather than a misleading enabled state.
        await this.#fail(entry.plugin, error);
      }
      throw error;
    }
  }

  async uninstall(id: string): Promise<void> {
    const entry = this.#registry.resolve(id);
    if (entry === undefined) {
      return; // Idempotent: already uninstalled.
    }
    const plugin = entry.plugin;
    try {
      if (plugin.lifecycle.is('enabled')) {
        plugin.setDeactivated();
        await plugin.deactivate();
      }
      plugin.lifecycle.transition('uninstalled', 'uninstall');
      await plugin.onUninstall(this.#hookContext(plugin));
      this.#registry.unregister(id);
      this.#logger.info(`plugin uninstalled: ${id}`);
    } catch (error) {
      await this.#fail(plugin, error);
      throw error;
    }
  }

  async rollback(id: string): Promise<PluginRegistryEntry> {
    const entry = this.#requireEntry(id);
    const plugin = entry.plugin;
    if (!plugin.lifecycle.is('failed')) {
      throw new PluginLifecycleError(
        `Rollback requires the failed state; ${id} is ${plugin.lifecycle.state}`,
      );
    }
    plugin.lifecycle.transition('installed', 'rollback');
    plugin.setDeactivated();
    this.#registry.updateState(id, 'installed', { lastError: undefined });
    this.#logger.info(`plugin rolled back to installed: ${id}`);
    return this.#registry.resolve(id) as PluginRegistryEntry;
  }

  // -- Internals ------------------------------------------------------------------

  #validateAll(manifest: PluginManifest): void {
    this.manifestValidator.assertValid(manifest);
    this.compatibilityValidator.assertCompatible(manifest, this.#platformVersion, this.#sdkVersion);
    const permissionIssues = this.permissionValidator.validate(manifest);
    if (permissionIssues.length > 0) {
      throw new PluginValidationError(
        `Plugin permission declaration is invalid (${permissionIssues.length} issue(s))`,
        permissionIssues.map((issue) => `${issue.field}: ${issue.message}`),
      );
    }
  }

  #requireEntry(id: string): PluginRegistryEntry {
    const entry = this.#registry.resolve(id);
    if (entry === undefined) {
      throw new PluginLifecycleError(`Plugin not installed: ${id}`);
    }
    return entry;
  }

  #hookContext(plugin: BasePlugin): PluginHookContext {
    return {
      pluginId: plugin.identity.id,
      configuration: plugin.configuration,
      timestamp: new Date().toISOString(),
    };
  }

  #pluginContext(plugin: BasePlugin): PluginContext {
    return {
      pluginId: plugin.identity.id,
      version: plugin.version,
      configuration: plugin.configuration,
      platformVersion: this.#platformVersion,
      sdkVersion: this.#sdkVersion,
      logger: this.#logger.with({ pluginId: plugin.identity.id }),
    };
  }

  /** Moves a plugin to `failed` and records the error in the registry. */
  async #fail(plugin: BasePlugin, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.#logger.error(`plugin operation failed: ${plugin.identity.id}`, error);
    if (plugin.lifecycle.canTransition('failed')) {
      plugin.lifecycle.transition('failed', message);
    }
    this.#registry.updateState(plugin.identity.id, 'failed', { lastError: message });
  }

  /**
   * Failure containment for `install`: removes any partially registered
   * entry so a failed install never leaves the platform in a partial state.
   */
  async #failAndRollback(plugin: BasePlugin): Promise<void> {
    if (this.#registry.resolve(plugin.identity.id) !== undefined) {
      if (plugin.lifecycle.is('enabled')) {
        plugin.setDeactivated();
      }
      plugin.lifecycle.transition('uninstalled', 'install-failure-rollback');
      this.#registry.unregister(plugin.identity.id);
    } else if (plugin.lifecycle.canTransition('failed')) {
      plugin.lifecycle.transition('failed', 'install-failure');
    }
  }

  /** The registry (for resolvers and tests). */
  get registry(): PluginRegistry {
    return this.#registry;
  }
}
