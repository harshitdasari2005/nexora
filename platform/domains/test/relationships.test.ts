/**
 * @nexora/module-domains — relationship tests (S24 Phase 1).
 *
 * Role → domain and role → capability relationships: unknown references are
 * rejected, duplicates are rejected, and catalog integrity (both directions)
 * is asserted after a registration batch.
 */

import { describe, expect, it } from 'vitest';
import type { DomainRoleDefinition } from '@nexora/contracts/domain';

import {
  assertCatalogIntegrity,
  createEmptyCatalog,
  DuplicateDefinitionError,
  InvalidDefinitionError,
  UnknownReferenceError,
} from '../src/index.js';

/** A catalog pre-seeded with one capability (domains are registered per test). */
function baseCatalog() {
  const catalog = createEmptyCatalog();
  catalog.capabilities.register({ id: 'projects.read', name: 'Read Projects' });
  return catalog;
}

/** Registers the technology domain (with the given role ids) into the catalog. */
function seedTechnologyDomain(
  catalog: ReturnType<typeof createEmptyCatalog>,
  roleIds: readonly string[],
): void {
  catalog.domains.register({ id: 'technology', name: 'Technology', roleIds });
}

function role(overrides: Partial<DomainRoleDefinition> = {}): DomainRoleDefinition {
  return {
    id: 'technology.developer',
    name: 'Developer',
    domainId: 'technology',
    capabilityIds: ['projects.read'],
    ...overrides,
  };
}

describe('role → domain / role → capability relationships', () => {
  it('rejects a role referencing an unknown domain', () => {
    const catalog = baseCatalog();
    seedTechnologyDomain(catalog, []);
    expect(() => catalog.roles.register(role({ domainId: 'legal' }))).toThrow(
      UnknownReferenceError,
    );
  });

  it('rejects a role referencing an unknown capability', () => {
    const catalog = baseCatalog();
    seedTechnologyDomain(catalog, []);
    expect(() => catalog.roles.register(role({ capabilityIds: ['contracts.read'] }))).toThrow(
      UnknownReferenceError,
    );
  });

  it('rejects a role with duplicate capabilities', () => {
    const catalog = baseCatalog();
    seedTechnologyDomain(catalog, []);
    expect(() =>
      catalog.roles.register(role({ capabilityIds: ['projects.read', 'projects.read'] })),
    ).toThrow(InvalidDefinitionError);
  });

  it('rejects a duplicate role in the same domain', () => {
    const catalog = baseCatalog();
    seedTechnologyDomain(catalog, []);
    catalog.roles.register(role());
    expect(() => catalog.roles.register(role())).toThrow(DuplicateDefinitionError);
  });

  it('rejects a domain listing duplicate roles', () => {
    const catalog = createEmptyCatalog();
    expect(() =>
      catalog.domains.register({
        id: 'technology',
        name: 'Technology',
        roleIds: ['technology.cto', 'technology.cto'],
      }),
    ).toThrow(InvalidDefinitionError);
  });
});

describe('catalog integrity', () => {
  it('passes for a consistent catalog', () => {
    const catalog = baseCatalog();
    seedTechnologyDomain(catalog, ['technology.developer']);
    catalog.roles.register(role());

    expect(() => assertCatalogIntegrity(catalog)).not.toThrow();
  });

  it('rejects a domain roleIds entry with no registered role', () => {
    const catalog = baseCatalog();
    seedTechnologyDomain(catalog, ['technology.developer', 'technology.ghost']);
    catalog.roles.register(role());

    expect(() => assertCatalogIntegrity(catalog)).toThrow(InvalidDefinitionError);
  });

  it('blocks a cross-domain role reference at domain registration (integrity backstop)', () => {
    // A domain may only list role ids namespaced by itself, so a role of
    // another domain can never appear in its roleIds — rejected at
    // registration, before integrity is even asserted (defense in depth).
    const catalog = baseCatalog();
    expect(() =>
      catalog.domains.register({
        id: 'technology',
        name: 'Technology',
        roleIds: ['technology.developer', 'executive.ceo'],
      }),
    ).toThrow(InvalidDefinitionError);
  });

  it('rejects a registered role omitted from its domain roleIds', () => {
    const catalog = baseCatalog();
    seedTechnologyDomain(catalog, []);
    // Domain roleIds does NOT include the role that gets registered.
    catalog.roles.register(role());

    expect(() => assertCatalogIntegrity(catalog)).toThrow(InvalidDefinitionError);
  });
});
