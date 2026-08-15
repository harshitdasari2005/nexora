/**
 * S24 Phase 2 — CommandCenterApplicationService tests: the resolution flow
 * (trusted role → definition → widget data → DTO), safe failure for unknown
 * roles and roles without a command center, and that the data provider
 * receives only the trusted context.
 */

import { describe, expect, it, vi } from 'vitest';
import { createInitialCatalog } from '@nexora/module-domains';

import {
  CommandCenterApplicationService,
  type CommandCenterContext,
  type CommandCenterRoleResolver,
  type CommandCenterWidgetDataProvider,
} from '../src/application/command-center-application-service.js';
import { CommandCenterRegistry } from '../src/registry/command-center-registry.js';
import { INITIAL_COMMAND_CENTERS } from '../src/seed/initial-command-centers.js';

interface Environment {
  service: CommandCenterApplicationService;
  resolveData: ReturnType<typeof vi.fn>;
}

function makeEnvironment(roleResolver: CommandCenterRoleResolver): Environment {
  const catalog = createInitialCatalog();
  const registry = new CommandCenterRegistry(catalog);
  // All three initial centers are registered so role resolution covers the
  // whole Phase 2 surface (the CEO assertions below still target the CEO
  // center because the resolver returns `executive.ceo`).
  for (const def of INITIAL_COMMAND_CENTERS) {
    registry.register(def);
  }
  const resolveData = vi.fn(async () => ({
    projects_kpi: { kind: 'kpi', value: '12', hint: 'Across the tenant' },
    activity: { kind: 'activity', items: [] },
  }));
  const dataProvider: CommandCenterWidgetDataProvider = { resolveData };
  const service = new CommandCenterApplicationService({
    registry,
    catalog,
    roleResolver,
    dataProvider,
  });
  return { service, resolveData };
}

const CONTEXT: CommandCenterContext = {
  userId: 'usr_alice',
  tenantId: 'org_acme',
  workspaceId: 'wsp_engineering',
};

describe('CommandCenterApplicationService (S24 Phase 2)', () => {
  it('resolves the command center from the trusted role and composes the DTO', async () => {
    const { service, resolveData } = makeEnvironment({
      resolve: async () => 'executive.ceo',
    });
    const result = await service.resolve(CONTEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.center.id).toBe('ceo');
    expect(result.center.roleId).toBe('executive.ceo');
    expect(result.center.roleName).toBe('CEO');
    expect(result.center.domainName).toBe('Executive');
    // The composed widgets are exactly the registered CEO definition's
    // widgets — the engine renders the registered configuration verbatim.
    expect(result.center.widgets.map((w) => w.id)).toEqual(
      INITIAL_COMMAND_CENTERS.find((def) => def.id === 'ceo')!.widgets.map((w) => w.id),
    );
    expect(result.center.actions).toHaveLength(3);
    expect(result.center.data.projects_kpi).toEqual({
      kind: 'kpi',
      value: '12',
      hint: 'Across the tenant',
    });
    expect(resolveData).toHaveBeenCalledWith(
      CONTEXT,
      INITIAL_COMMAND_CENTERS.find((def) => def.id === 'ceo')!.widgets,
    );
  });

  it('fails safely when the resolver returns no business role', async () => {
    const { service } = makeEnvironment({ resolve: async () => undefined });
    const result = await service.resolve(CONTEXT);
    expect(result).toEqual({ ok: false, reason: 'no-role' });
  });

  it('fails safely when the role has no command center registered', async () => {
    const { service } = makeEnvironment({ resolve: async () => 'security.ciso' });
    const result = await service.resolve(CONTEXT);
    expect(result).toEqual({ ok: false, reason: 'no-command-center' });
  });

  it('never consults a client-supplied role: only the resolver output matters', async () => {
    // A forged `role` claim in the context is structurally impossible — the
    // context carries trusted identity only; the resolver output is the sole
    // role input. This test pins that contract.
    const { service } = makeEnvironment({ resolve: async () => 'technology.developer' });
    const result = await service.resolve(CONTEXT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.center.roleId).toBe('technology.developer');
    }
  });

  it('renders every initial command center through the same engine', async () => {
    const catalog = createInitialCatalog();
    const registry = new CommandCenterRegistry(catalog);
    for (const def of INITIAL_COMMAND_CENTERS) {
      registry.register(def);
    }
    const resolveData = vi.fn(async () => ({}));
    const service = new CommandCenterApplicationService({
      registry,
      catalog,
      roleResolver: { resolve: async () => 'delivery.manager' },
      dataProvider: { resolveData },
    });
    const result = await service.resolve(CONTEXT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.center.id).toBe('manager');
      expect(result.center.widgets.length).toBeGreaterThan(0);
    }
  });
});
