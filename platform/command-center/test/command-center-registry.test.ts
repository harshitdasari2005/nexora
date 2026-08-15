/**
 * S24 Phase 2 — CommandCenterRegistry tests: registration, duplicate
 * rejection, lookup, list, and role resolution against the Phase 1 catalog.
 */

import { describe, expect, it } from 'vitest';
import { createInitialCatalog } from '@nexora/module-domains';
import type { CommandCenterDefinition } from '@nexora/contracts/command-center';

import { CommandCenterRegistry } from '../src/registry/command-center-registry.js';
import { DuplicateCommandCenterError } from '../src/errors.js';

const CEO_CENTER: CommandCenterDefinition = {
  id: 'ceo',
  name: 'Command Center',
  domainId: 'executive',
  roleId: 'executive.ceo',
  widgets: [
    {
      id: 'projects_kpi',
      type: 'kpi',
      title: 'Projects',
      dataSource: 'measurements.overview.projects',
      span: 1,
    },
  ],
  actions: [
    { id: 'view_projects', label: 'View projects', kind: 'navigate', href: '/app/projects' },
  ],
};

function makeRegistry(): CommandCenterRegistry {
  return new CommandCenterRegistry(createInitialCatalog());
}

describe('CommandCenterRegistry (S24 Phase 2)', () => {
  it('registers a valid command center and resolves it by id', () => {
    const registry = makeRegistry();
    registry.register(CEO_CENTER);
    expect(registry.has('ceo')).toBe(true);
    expect(registry.get('ceo')?.roleId).toBe('executive.ceo');
  });

  it('rejects a duplicate command-center id', () => {
    const registry = makeRegistry();
    registry.register(CEO_CENTER);
    expect(() => registry.register(CEO_CENTER)).toThrow(DuplicateCommandCenterError);
  });

  it('lists registered command centers in registration order', () => {
    const registry = makeRegistry();
    registry.register(CEO_CENTER);
    expect(registry.list().map((def) => def.id)).toEqual(['ceo']);
  });

  it('resolves a command center by the bound business role', () => {
    const registry = makeRegistry();
    registry.register(CEO_CENTER);
    expect(registry.resolveByRole('executive.ceo')?.id).toBe('ceo');
  });

  it('returns undefined for a role without a command center (fails safe)', () => {
    const registry = makeRegistry();
    registry.register(CEO_CENTER);
    expect(registry.resolveByRole('security.ciso')).toBeUndefined();
  });
});
