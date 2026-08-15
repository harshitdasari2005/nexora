/**
 * S24 Phase 2 — initial command-center integrity tests: every seeded
 * definition validates against the Phase 1 catalog (role binds to the
 * right domain), uses supported widget types and data sources, and resolves
 * through the registry. CEO / Manager / Developer are three DIFFERENT
 * compositions of the SAME engine — never three engines.
 */

import { describe, expect, it } from 'vitest';
import { createInitialCatalog } from '@nexora/module-domains';

import { CommandCenterRegistry } from '../src/registry/command-center-registry.js';
import { INITIAL_COMMAND_CENTERS } from '../src/seed/initial-command-centers.js';
import {
  COMMAND_CENTER_DATA_SOURCES,
  COMMAND_CENTER_WIDGET_TYPES,
} from '../src/validation/definitions.js';

function makeRegistry(): CommandCenterRegistry {
  const catalog = createInitialCatalog();
  const registry = new CommandCenterRegistry(catalog);
  for (const def of INITIAL_COMMAND_CENTERS) {
    registry.register(def);
  }
  return registry;
}

describe('Initial command centers (S24 Phase 2)', () => {
  it('registers all three initial command centers without error', () => {
    const registry = makeRegistry();
    expect(
      registry
        .list()
        .map((def) => def.id)
        .sort(),
    ).toEqual(['ceo', 'developer', 'manager']);
  });

  it('binds each center to a role that resolves in the Phase 1 catalog', () => {
    const registry = makeRegistry();
    expect(registry.resolveByRole('executive.ceo')?.id).toBe('ceo');
    expect(registry.resolveByRole('delivery.manager')?.id).toBe('manager');
    expect(registry.resolveByRole('technology.developer')?.id).toBe('developer');
  });

  it('uses only supported widget types and data sources', () => {
    for (const def of INITIAL_COMMAND_CENTERS) {
      for (const widget of def.widgets) {
        expect(COMMAND_CENTER_WIDGET_TYPES).toContain(widget.type);
        expect(COMMAND_CENTER_DATA_SOURCES).toContain(widget.dataSource);
      }
      for (const action of def.actions) {
        expect(action.kind).toBe('navigate');
        expect(action.href.length).toBeGreaterThan(0);
      }
    }
  });

  it('composes meaningfully different widget sets per role (three experiences, one engine)', () => {
    const byId = new Map(INITIAL_COMMAND_CENTERS.map((def) => [def.id, def]));
    const ceo = byId.get('ceo')!;
    const manager = byId.get('manager')!;
    const developer = byId.get('developer')!;
    expect(ceo.widgets.map((w) => w.dataSource)).toContain('workflows.health');
    expect(manager.widgets.map((w) => w.dataSource)).toContain('employees.list');
    expect(developer.widgets.map((w) => w.dataSource)).toContain('knowledge.articles');
    // The three centers are not identical compositions.
    const ids = (def: { widgets: readonly { id: string }[] }) =>
      def.widgets.map((w) => w.id).join(',');
    expect(new Set([ids(ceo), ids(manager), ids(developer)]).size).toBe(3);
  });

  it('keeps the CEO center focused on organization-level visibility', () => {
    const ceo = INITIAL_COMMAND_CENTERS.find((def) => def.id === 'ceo')!;
    expect(ceo.domainId).toBe('executive');
    expect(ceo.roleId).toBe('executive.ceo');
  });
});
