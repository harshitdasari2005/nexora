/**
 * @nexora/module-domains — RoleRegistry.
 *
 * The registry of {@link DomainRoleDefinition}s (S24 Phase 1). A role
 * belongs to exactly one domain and is validated at registration against
 * the registered domains and capabilities (S24 rules 4, 5, 7, 8). Roles
 * are BUSINESS CONTEXT: they never grant authorization — the existing
 * authorization system remains authoritative (ROLE ≠ PERMISSION).
 */

import type { DomainRoleDefinition } from '@nexora/contracts/domain';
import type { CapabilityRegistry } from './capability-registry.js';
import type { DomainRegistry } from './domain-registry.js';
import { DuplicateDefinitionError } from '../errors.js';
import { validateRoleDefinition } from '../validation/definitions.js';

/** The registries a role is validated against at registration. */
export interface RoleRegistryDependencies {
  /** Registered domains (role → domain association, S24 rule 4). */
  domains: DomainRegistry;
  /** Registered capabilities (role → capability affinity, S24 rule 5). */
  capabilities: CapabilityRegistry;
}

/** The registry of business role definitions. */
export class RoleRegistry {
  readonly #roles = new Map<string, DomainRoleDefinition>();

  constructor(private readonly deps: RoleRegistryDependencies) {}

  /**
   * Registers a role definition, validating it against the registered
   * domains and capabilities first.
   *
   * @throws {InvalidDefinitionError} when the definition is structurally invalid.
   * @throws {UnknownReferenceError} when the domain or a capability is unknown.
   * @throws {DuplicateDefinitionError} when the id is already registered.
   */
  register(def: DomainRoleDefinition): void {
    validateRoleDefinition(def, this.deps);
    if (this.#roles.has(def.id)) {
      throw new DuplicateDefinitionError('role', def.id);
    }
    this.#roles.set(def.id, def);
  }

  /** Resolves a role by id, or `undefined`. */
  get(id: string): DomainRoleDefinition | undefined {
    return this.#roles.get(id);
  }

  /** Whether a role with the id is registered. */
  has(id: string): boolean {
    return this.#roles.has(id);
  }

  /** All registered roles, in registration order. */
  list(): readonly DomainRoleDefinition[] {
    return [...this.#roles.values()];
  }

  /** All roles belonging to a domain, in registration order. */
  resolveByDomain(domainId: string): readonly DomainRoleDefinition[] {
    return [...this.#roles.values()].filter((role) => role.domainId === domainId);
  }
}
