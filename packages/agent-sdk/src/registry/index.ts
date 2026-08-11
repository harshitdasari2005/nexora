/**
 * @nexora/agent-sdk — registry.
 *
 * Agent registration and discovery (AIR.md §4): the `AgentRegistry` holds
 * descriptors and metadata for every registered agent; `AgentFactory`
 * constructs agent instances from manifests (the SDK side of the canonical
 * agent registry in `@nexora/contracts/registry`).
 */

import type { AgentManifest } from '@nexora/contracts/ai';
import type { AgentIdentity } from '@nexora/contracts/ai';
import type { AgentId } from '../types/index.js';

/** Metadata attached to a registered agent. */
export interface AgentMetadata {
  /** Agent id. */
  id: AgentId;
  /** ISO-8601 UTC time the agent registered. */
  registeredAt: string;
  /** ISO-8601 UTC time the agent was last seen healthy. */
  lastHealthyAt?: string;
}

/** A registry entry describing a registered agent. */
export interface AgentDescriptor {
  /** The agent identity. */
  identity: AgentIdentity;
  /** The agent manifest. */
  manifest: AgentManifest;
  /** Registration metadata. */
  metadata: AgentMetadata;
}

/**
 * The agent registry: registers and resolves agents by id (AIR.md §4 agent
 * registration).
 */
export class AgentRegistry {
  readonly #agents = new Map<string, AgentDescriptor>();

  /** Registers an agent descriptor. Throws on duplicate ids. */
  register(descriptor: AgentDescriptor): void {
    if (this.#agents.has(descriptor.identity.id)) {
      throw new Error(`Agent already registered: ${descriptor.identity.id}`);
    }
    this.#agents.set(descriptor.identity.id, descriptor);
  }

  /** Unregisters an agent. Returns true when one was removed. */
  unregister(id: string): boolean {
    return this.#agents.delete(id);
  }

  /** Resolves an agent descriptor by id, or `undefined`. */
  resolve(id: string): AgentDescriptor | undefined {
    return this.#agents.get(id);
  }

  /** All registered agent descriptors. */
  all(): readonly AgentDescriptor[] {
    return [...this.#agents.values()];
  }

  /** The number of registered agents. */
  get size(): number {
    return this.#agents.size;
  }
}

/**
 * The agent factory contract: constructs an agent from a manifest and its
 * dependencies. Concrete factories are provided by domains (e.g. HR Agent
 * factory); the SDK defines the contract only.
 */
export interface AgentFactory<TAgent> {
  /** Creates an agent instance from its manifest. */
  create(manifest: AgentManifest): TAgent;
}
