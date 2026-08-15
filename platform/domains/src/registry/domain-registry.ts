/**
 * @nexora/module-domains — DomainRegistry.
 *
 * The registry of {@link DomainDefinition}s (S24 Phase 1). Definitions are
 * registered at startup from code/config; registration is validated
 * deterministically and throws on duplicates or invalid shapes — invalid
 * configuration is never discovered mid-request. Resolution is a plain
 * in-memory read (no per-request scans, S22 budgets preserved).
 */

import type { DomainDefinition } from '@nexora/contracts/domain';
import { DuplicateDefinitionError } from '../errors.js';
import { validateDomainDefinition } from '../validation/definitions.js';

/** The registry of business domain definitions. */
export class DomainRegistry {
  readonly #domains = new Map<string, DomainDefinition>();

  /**
   * Registers a domain definition, validating it first.
   *
   * @throws {InvalidDefinitionError} when the definition is invalid.
   * @throws {DuplicateDefinitionError} when the id is already registered.
   */
  register(def: DomainDefinition): void {
    validateDomainDefinition(def);
    if (this.#domains.has(def.id)) {
      throw new DuplicateDefinitionError('domain', def.id);
    }
    this.#domains.set(def.id, def);
  }

  /** Resolves a domain by id, or `undefined`. */
  get(id: string): DomainDefinition | undefined {
    return this.#domains.get(id);
  }

  /** Whether a domain with the id is registered. */
  has(id: string): boolean {
    return this.#domains.has(id);
  }

  /** All registered domains, in registration order. */
  list(): readonly DomainDefinition[] {
    return [...this.#domains.values()];
  }
}
