/**
 * @nexora/module-domains — domain catalog composition.
 *
 * The composition root of the Domain → Role → Capability registries (S24
 * Phase 1). A catalog owns one of each registry and, for the initial
 * catalog, registers the first-party definitions in dependency order
 * (capabilities → domains → roles, since roles validate against the other
 * two) and asserts catalog integrity afterwards. Definitions are code/config
 * registered — deterministic at startup, no per-request scans (S22 budgets).
 *
 * The catalog is the extension seam for future Marketplace-installed
 * domains: an installed domain registers its definitions into the same
 * registries (roles validated against the same domains + capabilities)
 * without changing the core registry implementation.
 */

import { CapabilityRegistry } from '../registry/capability-registry.js';
import { DomainRegistry } from '../registry/domain-registry.js';
import { RoleRegistry } from '../registry/role-registry.js';
import { InvalidDefinitionError } from '../errors.js';
import { validateCatalogIntegrity } from '../validation/definitions.js';
import { INITIAL_CAPABILITIES, INITIAL_DOMAINS, INITIAL_ROLES } from './initial-definitions.js';

/** The three registries of one domain catalog. */
export interface DomainCatalog {
  /** Registered business domains. */
  domains: DomainRegistry;
  /** Registered business roles (validated against domains + capabilities). */
  roles: RoleRegistry;
  /** Registered capability vocabulary. */
  capabilities: CapabilityRegistry;
}

/** Builds an empty catalog (domains + capabilities wired for role validation). */
export function createEmptyCatalog(): DomainCatalog {
  const domains = new DomainRegistry();
  const capabilities = new CapabilityRegistry();
  const roles = new RoleRegistry({ domains, capabilities });
  return { domains, roles, capabilities };
}

/**
 * Asserts catalog integrity after a registration batch: every domain
 * roleIds entry resolves to a registered role owned by that domain, and
 * every registered role is listed by its owning domain.
 *
 * @throws {InvalidDefinitionError} when the catalog is inconsistent.
 */
export function assertCatalogIntegrity(catalog: DomainCatalog): void {
  const issues = validateCatalogIntegrity(catalog);
  if (issues.length > 0) {
    throw new InvalidDefinitionError('catalog', 'domain-definitions', issues);
  }
}

/**
 * Registers the first-party initial definitions into a catalog
 * (capabilities → domains → roles) and asserts catalog integrity.
 *
 * @throws {DomainDefinitionError} when the seed is invalid (fail fast at startup).
 */
export function registerInitialDefinitions(catalog: DomainCatalog): void {
  for (const capability of INITIAL_CAPABILITIES) {
    catalog.capabilities.register(capability);
  }
  for (const domain of INITIAL_DOMAINS) {
    catalog.domains.register(domain);
  }
  for (const role of INITIAL_ROLES) {
    catalog.roles.register(role);
  }
  assertCatalogIntegrity(catalog);
}

/** Builds the initial catalog with the first-party definitions registered. */
export function createInitialCatalog(): DomainCatalog {
  const catalog = createEmptyCatalog();
  registerInitialDefinitions(catalog);
  return catalog;
}
