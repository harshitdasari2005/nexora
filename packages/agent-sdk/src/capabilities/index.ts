/**
 * @nexora/agent-sdk — capabilities.
 *
 * Capabilities are the discovery surface of an agent (AIR.md §5): what the
 * Enterprise AI Orchestrator can ask the agent to do. The canonical shape is
 * `CapabilityDeclaration`/`CapabilityContract` from `@nexora/contracts/ai`;
 * this module adds the generic registry and descriptor.
 */

import type { CapabilityContract } from '@nexora/contracts/ai';
import type { CapabilityId, SkillId } from '../types/index.js';

/** A capability manifest: the declarative contract of a capability. */
export interface CapabilityManifest {
  /** Capability id, e.g. `projects.create_project`. */
  id: CapabilityId;
  /** Capability name. */
  name: string;
  /** Description for the planner. */
  description: string;
  /** The skill id that implements this capability. */
  skillId: SkillId;
  /** Side-effect class for risk analysis (AIR.md §7.5). */
  sideEffectClass: CapabilityContract['sideEffectClass'];
  /** Whether the capability mutates state. */
  mutatesState: boolean;
}

/**
 * A capability: the discoverable unit an agent offers. Implementations
 * delegate to the underlying skill.
 */
export interface Capability {
  /** The capability manifest. */
  readonly manifest: CapabilityManifest;
}

/** Metadata attached to a registered capability. */
export interface CapabilityMetadata {
  /** Capability id. */
  id: CapabilityId;
  /** ISO-8601 UTC time the capability was registered. */
  registeredAt: string;
}

/** A registry entry for a registered capability. */
export interface CapabilityDescriptor {
  /** The capability manifest. */
  manifest: CapabilityManifest;
  /** Registration metadata. */
  metadata: CapabilityMetadata;
}

/**
 * The capability registry: registers and resolves capabilities by id
 * (AIR.md §5 capability registry). The Enterprise AI discovers capabilities
 * from this registry — it never hardcodes applications (SAD.md §10).
 */
export class CapabilityRegistry {
  readonly #capabilities = new Map<string, Capability>();
  readonly #metadata = new Map<string, CapabilityMetadata>();

  /** Registers a capability. Throws on duplicate ids. */
  register(capability: Capability): void {
    if (this.#capabilities.has(capability.manifest.id)) {
      throw new Error(`Capability already registered: ${capability.manifest.id}`);
    }
    this.#capabilities.set(capability.manifest.id, capability);
    this.#metadata.set(capability.manifest.id, {
      id: capability.manifest.id,
      registeredAt: new Date().toISOString(),
    });
  }

  /** Removes a capability by id. Returns true when one was removed. */
  unregister(id: string): boolean {
    return this.#capabilities.delete(id) && this.#metadata.delete(id);
  }

  /** Returns the registered capability, or `undefined`. */
  resolve(id: string): Capability | undefined {
    return this.#capabilities.get(id);
  }

  /** Returns the capability descriptor, or `undefined`. */
  describe(id: string): CapabilityDescriptor | undefined {
    const manifest = this.#capabilities.get(id)?.manifest;
    const metadata = this.#metadata.get(id);
    if (manifest === undefined || metadata === undefined) {
      return undefined;
    }
    return { manifest, metadata };
  }

  /** All registered capability ids. */
  ids(): readonly string[] {
    return [...this.#capabilities.keys()];
  }

  /** The number of registered capabilities. */
  get size(): number {
    return this.#capabilities.size;
  }

  /** Converts every registered capability to its canonical contract shape. */
  toContracts(): readonly CapabilityContract[] {
    return [...this.#capabilities.values()].map((capability) => ({
      id: capability.manifest.id,
      name: capability.manifest.name,
      description: capability.manifest.description,
      skillId: capability.manifest.skillId,
      sideEffectClass: capability.manifest.sideEffectClass,
      mutatesState: capability.manifest.mutatesState,
    }));
  }
}
