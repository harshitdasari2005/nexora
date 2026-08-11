/**
 * @nexora/plugin-sdk — registry.
 *
 * Plugin registration and discovery (SAD.md §7.2): the `PluginRegistry`
 * holds entries for every loaded plugin; `PluginResolver` is the lookup
 * contract installers and dependency resolution use. The canonical
 * `PluginDescriptor` (`@nexora/contracts/plugin`) is re-exported; the SDK
 * entry adds the plugin instance and SDK lifecycle state.
 */

export type { PluginDescriptor } from '@nexora/contracts/plugin';

import type { PluginDescriptor } from '@nexora/contracts/plugin';
import type { BasePlugin } from '../base/index.js';
import { toCanonicalState } from '../lifecycle/index.js';
import type { PluginState } from '../lifecycle/index.js';
import type { PluginId } from '../types/index.js';

/** A registry entry for a loaded plugin. */
export interface PluginRegistryEntry {
  /** The plugin instance. */
  plugin: BasePlugin;
  /** The canonical descriptor (projected on lifecycle transitions). */
  descriptor: PluginDescriptor;
  /** The SDK lifecycle state (authoritative). */
  state: PluginState;
  /** ISO-8601 UTC time the plugin was registered. */
  registeredAt: string;
  /** ISO-8601 UTC time the plugin was installed, when installed. */
  installedAt?: string;
  /** ISO-8601 UTC time the plugin was last enabled, when enabled. */
  enabledAt?: string;
  /** Last lifecycle error message, when the plugin is in `failed`. */
  lastError?: string;
}

/** Registration metadata attached to a plugin (registry bookkeeping). */
export interface PluginRegistrationMetadata {
  /** Plugin id. */
  id: PluginId;
  /** ISO-8601 UTC time of registration. */
  registeredAt: string;
  /** The recorded lifecycle state transitions (audit). */
  transitions: readonly { from: PluginState; to: PluginState; occurredAt: string }[];
}

/** A factory that constructs a plugin instance. */
export type PluginFactory = () => BasePlugin | Promise<BasePlugin>;

/** The plugin lookup contract (used by installers and validators). */
export interface PluginResolver {
  /** Resolves a plugin entry by id, or `undefined`. */
  resolve(id: PluginId): PluginRegistryEntry | undefined;
}

/**
 * The plugin registry: registers, resolves, and lists loaded plugins
 * (SAD.md §7.2). In-memory; the platform persists registry state for
 * durability.
 */
export class PluginRegistry implements PluginResolver {
  readonly #entries = new Map<PluginId, PluginRegistryEntry>();

  /** Registers an entry. Throws on duplicate ids. */
  register(entry: PluginRegistryEntry): void {
    if (this.#entries.has(entry.descriptor.id)) {
      throw new Error(`Plugin already registered: ${entry.descriptor.id}`);
    }
    this.#entries.set(entry.descriptor.id, entry);
  }

  /** Unregisters an entry. Returns true when one was removed. */
  unregister(id: PluginId): boolean {
    return this.#entries.delete(id);
  }

  /** Resolves an entry by id, or `undefined`. */
  resolve(id: PluginId): PluginRegistryEntry | undefined {
    return this.#entries.get(id);
  }

  /** Updates the entry for a state change (lifecycle bookkeeping). */
  updateState(
    id: PluginId,
    state: PluginState,
    updates: { installedAt?: string; enabledAt?: string; lastError?: string } = {},
  ): void {
    const entry = this.#entries.get(id);
    if (entry === undefined) {
      return;
    }
    this.#entries.set(id, {
      ...entry,
      state,
      descriptor: { ...entry.descriptor, state: toCanonicalState(state) },
      ...updates,
    });
  }

  /** All registered entries. */
  all(): readonly PluginRegistryEntry[] {
    return [...this.#entries.values()];
  }

  /** All registered plugin ids. */
  ids(): readonly PluginId[] {
    return [...this.#entries.keys()];
  }

  /** The number of registered plugins. */
  get size(): number {
    return this.#entries.size;
  }
}
