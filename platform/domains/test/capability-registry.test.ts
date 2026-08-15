/**
 * @nexora/module-domains — CapabilityRegistry tests (S24 Phase 1).
 *
 * Valid registration, duplicate rejection, lookup, listing, unknown
 * capabilities, and invalid definition rejection.
 */

import { describe, expect, it } from 'vitest';
import type { CapabilityDefinition } from '@nexora/contracts/domain';

import {
  CapabilityRegistry,
  DuplicateDefinitionError,
  InvalidDefinitionError,
} from '../src/index.js';

function capability(overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'projects.read',
    name: 'Read Projects',
    description: 'Read project records',
    ...overrides,
  };
}

describe('CapabilityRegistry', () => {
  it('registers and resolves a valid capability', () => {
    const registry = new CapabilityRegistry();
    const def = capability();

    registry.register(def);

    expect(registry.get('projects.read')).toBe(def);
    expect(registry.has('projects.read')).toBe(true);
  });

  it('rejects a duplicate capability id', () => {
    const registry = new CapabilityRegistry();
    registry.register(capability());

    expect(() => registry.register(capability())).toThrow(DuplicateDefinitionError);
  });

  it('returns undefined for an unknown capability', () => {
    const registry = new CapabilityRegistry();
    expect(registry.get('contracts.read')).toBeUndefined();
    expect(registry.has('contracts.read')).toBe(false);
  });

  it('lists registered capabilities in registration order', () => {
    const registry = new CapabilityRegistry();
    registry.register(capability());
    registry.register(capability({ id: 'projects.create', name: 'Create Projects' }));

    expect(registry.list().map((def) => def.id)).toEqual(['projects.read', 'projects.create']);
  });

  it('rejects an invalid capability id', () => {
    const registry = new CapabilityRegistry();
    for (const id of [
      'Projects.read',
      'projects read',
      '',
      'projects.',
      '.read',
      'projects..read',
    ]) {
      expect(() => registry.register(capability({ id }))).toThrow(InvalidDefinitionError);
    }
  });

  it('rejects an empty capability name', () => {
    const registry = new CapabilityRegistry();
    expect(() => registry.register(capability({ name: '' }))).toThrow(InvalidDefinitionError);
  });
});
