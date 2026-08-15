/**
 * @nexora/module-domains — RoleRegistry tests (S24 Phase 1).
 *
 * Valid registration, duplicate rejection, domain association, lookup,
 * listing, and role resolution by domain.
 */

import { describe, expect, it } from 'vitest';
import type { DomainRoleDefinition } from '@nexora/contracts/domain';

import {
  CapabilityRegistry,
  DomainRegistry,
  DuplicateDefinitionError,
  InvalidDefinitionError,
  RoleRegistry,
} from '../src/index.js';

/** Builds an empty catalog with the registries the role registry needs. */
function harness() {
  const domains = new DomainRegistry();
  const capabilities = new CapabilityRegistry();
  domains.register({ id: 'technology', name: 'Technology', roleIds: [] });
  capabilities.register({ id: 'projects.read', name: 'Read Projects' });
  const roles = new RoleRegistry({ domains, capabilities });
  return { domains, capabilities, roles };
}

function role(overrides: Partial<DomainRoleDefinition> = {}): DomainRoleDefinition {
  return {
    id: 'technology.developer',
    name: 'Developer',
    description: 'Builds software',
    domainId: 'technology',
    capabilityIds: ['projects.read'],
    ...overrides,
  };
}

describe('RoleRegistry', () => {
  it('registers and resolves a valid role', () => {
    const { roles } = harness();
    const def = role();

    roles.register(def);

    expect(roles.get('technology.developer')).toBe(def);
    expect(roles.has('technology.developer')).toBe(true);
  });

  it('rejects a duplicate role id', () => {
    const { roles } = harness();
    roles.register(role());

    expect(() => roles.register(role())).toThrow(DuplicateDefinitionError);
  });

  it('returns undefined for an unknown role', () => {
    const { roles } = harness();
    expect(roles.get('finance.cfo')).toBeUndefined();
    expect(roles.has('finance.cfo')).toBe(false);
  });

  it('lists registered roles in registration order', () => {
    const { roles } = harness();
    roles.register(role());
    roles.register(role({ id: 'technology.cto', name: 'CTO' }));

    expect(roles.list().map((def) => def.id)).toEqual(['technology.developer', 'technology.cto']);
  });

  it('resolves roles by domain', () => {
    const { domains, roles } = harness();
    roles.register(role());
    roles.register(role({ id: 'technology.cto', name: 'CTO' }));
    domains.register({
      id: 'finance',
      name: 'Finance',
      roleIds: ['finance.cfo'],
    });
    roles.register(role({ id: 'finance.cfo', name: 'CFO', domainId: 'finance' }));

    expect(roles.resolveByDomain('technology').map((def) => def.id)).toEqual([
      'technology.developer',
      'technology.cto',
    ]);
    expect(roles.resolveByDomain('finance').map((def) => def.id)).toEqual(['finance.cfo']);
    expect(roles.resolveByDomain('unknown')).toEqual([]);
  });

  it('rejects a role whose id is not namespaced by its domain', () => {
    const { roles } = harness();
    expect(() => roles.register(role({ id: 'finance.cfo', domainId: 'technology' }))).toThrow(
      InvalidDefinitionError,
    );
  });

  it('rejects a role with an invalid id or empty name', () => {
    const { roles } = harness();
    expect(() => roles.register(role({ id: 'Technology.CTO' }))).toThrow(InvalidDefinitionError);
    expect(() => roles.register(role({ name: '' }))).toThrow(InvalidDefinitionError);
  });
});
