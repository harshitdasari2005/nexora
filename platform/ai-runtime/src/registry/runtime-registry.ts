/**
 * @nexora/ai-runtime — runtime registry.
 *
 * The platform-side capability registry (SAD.md §10, AIR.md §1.2 R10): a
 * read-model over registered capabilities, agents, tools, workflows, and
 * plugins. Entries are the canonical `RegistryEntryUnion` types from
 * `@nexora/contracts/registry`. The App Platform *writes* the registry at
 * install time; the AI Runtime only reads it for discovery (DDD §2.3).
 */

import type {
  AgentRegistryEntry,
  CapabilityRegistryEntry,
  PluginRegistryEntry,
  RegistryEntryUnion,
  RegistryType,
  ToolRegistryEntry,
  WorkflowRegistryEntry,
} from '@nexora/contracts/registry';
import type {
  AgentIdentity,
  AgentManifest,
  CapabilityDeclaration,
  ToolContract,
} from '@nexora/contracts/ai';
import type { WorkflowDefinition } from '@nexora/contracts/workflow';
import type { PluginDescriptor, PluginManifest } from '@nexora/contracts/plugin';

/**
 * The runtime registry: stores canonical entries keyed by `${registry}:${id}`,
 * tracks the active flag, and exposes typed queries for discovery.
 */
export class RuntimeRegistry {
  readonly #entries = new Map<string, RegistryEntryUnion>();

  /** Registers an entry. Throws on duplicate keys. */
  register(entry: RegistryEntryUnion): void {
    const key = registryKey(entry.registry, entry.id);
    if (this.#entries.has(key)) {
      throw new Error(`Registry entry already registered: ${key}`);
    }
    this.#entries.set(key, entry);
  }

  /** Replaces an existing entry (same key). Throws when absent. */
  update(entry: RegistryEntryUnion): void {
    const key = registryKey(entry.registry, entry.id);
    if (!this.#entries.has(key)) {
      throw new Error(`Registry entry not found: ${key}`);
    }
    this.#entries.set(key, { ...entry, updatedAt: new Date().toISOString() });
  }

  /** Removes an entry. Returns true when one was removed. */
  unregister(registry: RegistryType, id: string): boolean {
    return this.#entries.delete(registryKey(registry, id));
  }

  /** Resolves an entry, or `undefined`. */
  resolve(registry: RegistryType, id: string): RegistryEntryUnion | undefined {
    return this.#entries.get(registryKey(registry, id));
  }

  /** Sets the active flag of an entry (enable/disable discovery visibility). */
  setActive(registry: RegistryType, id: string, active: boolean): void {
    const key = registryKey(registry, id);
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      throw new Error(`Registry entry not found: ${key}`);
    }
    this.#entries.set(key, { ...entry, active, updatedAt: new Date().toISOString() });
  }

  /** All active capability declarations. */
  capabilities(): readonly CapabilityRegistryEntry[] {
    return this.#of('capability') as readonly CapabilityRegistryEntry[];
  }

  /** All active tool entries. */
  tools(): readonly ToolRegistryEntry[] {
    return this.#of('tool') as readonly ToolRegistryEntry[];
  }

  /** All active agent entries. */
  agents(): readonly AgentRegistryEntry[] {
    return this.#of('agent') as readonly AgentRegistryEntry[];
  }

  /** All active workflow entries. */
  workflows(): readonly WorkflowRegistryEntry[] {
    return this.#of('workflow') as readonly WorkflowRegistryEntry[];
  }

  /** All active plugin entries. */
  plugins(): readonly PluginRegistryEntry[] {
    return this.#of('plugin') as readonly PluginRegistryEntry[];
  }

  /** Every entry of a registry type (active and inactive). */
  allOf(registry: RegistryType): readonly RegistryEntryUnion[] {
    return [...this.#entries.values()].filter((entry) => entry.registry === registry);
  }

  /** The number of registered entries. */
  get size(): number {
    return this.#entries.size;
  }

  #of(registry: RegistryType): readonly RegistryEntryUnion[] {
    return [...this.#entries.values()].filter(
      (entry) => entry.registry === registry && entry.active,
    );
  }
}

/** Builds the canonical storage key for a registry entry. */
export function registryKey(registry: RegistryType, id: string): string {
  return `${registry}:${id}`;
}

/** Helpers to construct canonical registry entries (contracts shapes). */
export const registryEntries = {
  capability(entry: {
    capability: CapabilityDeclaration;
    owner: string;
    version: string;
  }): CapabilityRegistryEntry {
    const now = new Date().toISOString();
    return {
      id: entry.capability.id,
      registry: 'capability',
      version: entry.version,
      owner: entry.owner,
      active: true,
      registeredAt: now,
      updatedAt: now,
      capability: entry.capability,
    };
  },

  tool(entry: {
    tool: ToolContract;
    owner: string;
    version: string;
    ownedByAgents: readonly string[];
  }): ToolRegistryEntry {
    const now = new Date().toISOString();
    return {
      id: entry.tool.id,
      registry: 'tool',
      version: entry.version,
      owner: entry.owner,
      active: true,
      registeredAt: now,
      updatedAt: now,
      tool: entry.tool,
      ownedByAgents: entry.ownedByAgents,
    };
  },

  agent(entry: {
    agent: AgentIdentity;
    manifest: AgentManifest;
    health: 'healthy' | 'degraded' | 'unavailable';
    owner: string;
    version: string;
  }): AgentRegistryEntry {
    const now = new Date().toISOString();
    return {
      id: entry.agent.id,
      registry: 'agent',
      version: entry.version,
      owner: entry.owner,
      active: true,
      registeredAt: now,
      updatedAt: now,
      agent: entry.agent,
      manifest: entry.manifest,
      health: entry.health,
    };
  },

  workflow(entry: {
    workflow: WorkflowDefinition;
    owner: string;
    version: string;
  }): WorkflowRegistryEntry {
    const now = new Date().toISOString();
    return {
      id: entry.workflow.id,
      registry: 'workflow',
      version: entry.version,
      owner: entry.owner,
      active: true,
      registeredAt: now,
      updatedAt: now,
      workflow: entry.workflow,
    };
  },

  plugin(entry: {
    plugin: PluginDescriptor;
    manifest: PluginManifest;
    owner: string;
    version: string;
  }): PluginRegistryEntry {
    const now = new Date().toISOString();
    return {
      id: entry.plugin.id,
      registry: 'plugin',
      version: entry.version,
      owner: entry.owner,
      active: true,
      registeredAt: now,
      updatedAt: now,
      plugin: entry.plugin,
      manifest: entry.manifest,
    };
  },
} as const;
