/**
 * @nexora/contracts — registry contracts.
 *
 * The registries that make capability discovery possible (SAD.md §10, AIR.md
 * §5): capability, agent, plugin, tool, and workflow registries. The
 * Enterprise AI Orchestrator discovers capabilities from these registries —
 * it never hardcodes applications (SAD.md §10).
 */

import type {
  AgentIdentity,
  AgentManifest,
  AgentSkill,
  AgentTool,
  CapabilityDeclaration,
  ToolContract,
} from '../ai/index.js';
import type { PluginDescriptor, PluginManifest } from '../plugin/index.js';
import type { WorkflowDefinition } from '../workflow/index.js';
import type { SemVer, Timestamp } from '../common/index.js';

/** The kinds of registry entries the platform maintains. */
export const REGISTRY_TYPES = ['capability', 'agent', 'plugin', 'tool', 'workflow'] as const;

/** Single registry type literal. */
export type RegistryType = (typeof REGISTRY_TYPES)[number];

/**
 * The base registry entry: every entry is versioned, timed, and carries its
 * owning scope.
 */
export interface RegistryEntry {
  /** Entry id, unique within the registry. */
  id: string;
  /** Registry type. */
  registry: RegistryType;
  /** Semantic version of the registered artifact. */
  version: SemVer;
  /** Owning plugin/domain id. */
  owner: string;
  /** Whether the entry is currently discoverable. */
  active: boolean;
  /** ISO-8601 UTC time the entry was registered. */
  registeredAt: Timestamp;
  /** ISO-8601 UTC time the entry was last updated. */
  updatedAt: Timestamp;
}

/** A capability registry entry (SAD.md §10 Capability Registry). */
export interface CapabilityRegistryEntry extends RegistryEntry {
  /** Registry type is always `capability`. */
  registry: 'capability';
  /** The capability declaration. */
  capability: CapabilityDeclaration;
}

/** An agent registry entry (AIR.md §4 agent registration). */
export interface AgentRegistryEntry extends RegistryEntry {
  /** Registry type is always `agent`. */
  registry: 'agent';
  /** The registered agent identity. */
  agent: AgentIdentity;
  /** The agent manifest (may be partially hydrated). */
  manifest: AgentManifest;
  /** Agent health state for monitoring (AIR.md §16). */
  health: 'healthy' | 'degraded' | 'unavailable';
}

/** A plugin registry entry (SAD.md §7.3). */
export interface PluginRegistryEntry extends RegistryEntry {
  /** Registry type is always `plugin`. */
  registry: 'plugin';
  /** The plugin descriptor. */
  plugin: PluginDescriptor;
  /** The plugin manifest. */
  manifest: PluginManifest;
}

/** A tool registry entry (SAD.md §10 Tool Registry). */
export interface ToolRegistryEntry extends RegistryEntry {
  /** Registry type is always `tool`. */
  registry: 'tool';
  /** The tool contract. */
  tool: ToolContract;
  /** Owning agent ids that may invoke the tool. */
  ownedByAgents: readonly string[];
}

/** A workflow registry entry (SAD.md §12 workflow definitions). */
export interface WorkflowRegistryEntry extends RegistryEntry {
  /** Registry type is always `workflow`. */
  registry: 'workflow';
  /** The workflow definition. */
  workflow: WorkflowDefinition;
}

/** Union of all registry entry types; discriminate with `registry`. */
export type RegistryEntryUnion =
  | CapabilityRegistryEntry
  | AgentRegistryEntry
  | PluginRegistryEntry
  | ToolRegistryEntry
  | WorkflowRegistryEntry;

/** A compact discovery result returned to the planner (AIR.md §5.2). */
export interface DiscoveryResult {
  /** Capabilities matching the planner's query. */
  capabilities: readonly CapabilityDeclaration[];
  /** Skills matching the query. */
  skills: readonly AgentSkill[];
  /** Tools matching the query. */
  tools: readonly AgentTool[];
  /** Agents owning the matched capabilities. */
  agents: readonly AgentIdentity[];
}
