/**
 * @nexora/module-domains — DomainRegistry tests (S24 Phase 1).
 *
 * Valid registration, duplicate rejection, lookup, listing, unknown
 * domains, and invalid definition rejection.
 */

import { describe, expect, it } from 'vitest';
import type { DomainDefinition } from '@nexora/contracts/domain';

import { DomainRegistry, DuplicateDefinitionError, InvalidDefinitionError } from '../src/index.js';

function domain(overrides: Partial<DomainDefinition> = {}): DomainDefinition {
  return {
    id: 'technology',
    name: 'Technology',
    description: 'Engineering and technology',
    roleIds: ['technology.cto'],
    ...overrides,
  };
}

describe('DomainRegistry', () => {
  it('registers and resolves a valid domain', () => {
    const registry = new DomainRegistry();
    const def = domain();

    registry.register(def);

    expect(registry.get('technology')).toBe(def);
    expect(registry.has('technology')).toBe(true);
  });

  it('rejects a duplicate domain id', () => {
    const registry = new DomainRegistry();
    registry.register(domain());

    expect(() => registry.register(domain())).toThrow(DuplicateDefinitionError);
  });

  it('returns undefined for an unknown domain', () => {
    const registry = new DomainRegistry();
    expect(registry.get('finance')).toBeUndefined();
    expect(registry.has('finance')).toBe(false);
  });

  it('lists registered domains in registration order', () => {
    const registry = new DomainRegistry();
    registry.register(domain({ id: 'executive', name: 'Executive', roleIds: [] }));
    registry.register(domain({ id: 'finance', name: 'Finance', roleIds: [] }));

    expect(registry.list().map((def) => def.id)).toEqual(['executive', 'finance']);
  });

  it('rejects an invalid domain id', () => {
    const registry = new DomainRegistry();
    for (const id of ['Technology', 'tech nology', '', 'tech.', '9tech', 'tech.team']) {
      expect(() => registry.register(domain({ id }))).toThrow(InvalidDefinitionError);
    }
  });

  it('rejects an empty domain name', () => {
    const registry = new DomainRegistry();
    expect(() => registry.register(domain({ name: '  ' }))).toThrow(InvalidDefinitionError);
  });

  it('rejects a domain with duplicate role ids', () => {
    const registry = new DomainRegistry();
    expect(() =>
      registry.register(domain({ roleIds: ['technology.cto', 'technology.cto'] })),
    ).toThrow(InvalidDefinitionError);
  });

  it('rejects a domain with role ids not namespaced by the domain', () => {
    const registry = new DomainRegistry();
    expect(() => registry.register(domain({ roleIds: ['finance.cfo'] }))).toThrow(
      InvalidDefinitionError,
    );
  });
});
