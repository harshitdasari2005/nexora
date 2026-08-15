/**
 * @nexora/module-domains — CapabilityRegistry.
 *
 * The registry of {@link CapabilityDefinition}s (S24 Phase 1). Capabilities
 * are the stable, machine-readable operation vocabulary (e.g.
 * `projects.read`) registered GLOBALLY — they span domains and roles.
 * Registration is validated deterministically and throws on duplicates or
 * invalid shapes; resolution is an in-memory read (S22 budgets preserved).
 *
 * A capability is a definition only: nothing in this registry binds a
 * capability to an executable tool or to authorization. Tool resolution
 * (native tool vs MCP tool) is a later phase; the existing authorization
 * system remains the only authority for access.
 */

import type { CapabilityDefinition } from '@nexora/contracts/domain';
import { DuplicateDefinitionError } from '../errors.js';
import { validateCapabilityDefinition } from '../validation/definitions.js';

/** The registry of capability definitions. */
export class CapabilityRegistry {
  readonly #capabilities = new Map<string, CapabilityDefinition>();

  /**
   * Registers a capability definition, validating it first.
   *
   * @throws {InvalidDefinitionError} when the definition is invalid.
   * @throws {DuplicateDefinitionError} when the id is already registered.
   */
  register(def: CapabilityDefinition): void {
    validateCapabilityDefinition(def);
    if (this.#capabilities.has(def.id)) {
      throw new DuplicateDefinitionError('capability', def.id);
    }
    this.#capabilities.set(def.id, def);
  }

  /** Resolves a capability by id, or `undefined`. */
  get(id: string): CapabilityDefinition | undefined {
    return this.#capabilities.get(id);
  }

  /** Whether a capability with the id is registered. */
  has(id: string): boolean {
    return this.#capabilities.has(id);
  }

  /** All registered capabilities, in registration order. */
  list(): readonly CapabilityDefinition[] {
    return [...this.#capabilities.values()];
  }
}
