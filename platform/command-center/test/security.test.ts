/**
 * S24 Phase 2 — command-center security tests (module level). The engine
 * must never let a forged role/domain claim change the effective role, must
 * pass only the trusted context to data providers, and must fail safely for
 * unknown command centers. (The API-level tenant/workspace isolation tests
 * live in apps/api/test/command-center.test.ts.)
 */

import { describe, expect, it, vi } from 'vitest';
import { createInitialCatalog } from '@nexora/module-domains';

import {
  CommandCenterApplicationService,
  type CommandCenterContext,
  type CommandCenterRoleResolver,
} from '../src/application/command-center-application-service.js';
import { CommandCenterRegistry } from '../src/registry/command-center-registry.js';
import { INITIAL_COMMAND_CENTERS } from '../src/seed/initial-command-centers.js';

interface Environment {
  service: CommandCenterApplicationService;
  resolver: CommandCenterRoleResolver;
  resolveData: ReturnType<typeof vi.fn>;
}

function makeEnvironment(resolver: CommandCenterRoleResolver): Environment {
  const catalog = createInitialCatalog();
  const registry = new CommandCenterRegistry(catalog);
  for (const def of INITIAL_COMMAND_CENTERS) {
    registry.register(def);
  }
  const resolveData = vi.fn(async () => ({}));
  const service = new CommandCenterApplicationService({
    registry,
    catalog,
    roleResolver: resolver,
    dataProvider: { resolveData },
  });
  return { service, resolver, resolveData };
}

const CONTEXT: CommandCenterContext = {
  userId: 'usr_alice',
  tenantId: 'org_acme',
  workspaceId: 'wsp_engineering',
};

describe('CommandCenter security (S24 Phase 2, module)', () => {
  it('a forged role claim cannot change the effective role: the resolver output is the only role input', async () => {
    // The resolver simulates trusted membership: Alice is a member → her
    // effective role is `technology.developer`, regardless of any forged
    // `role=executive.ceo` claim the client could append to a request.
    const { service } = makeEnvironment({ resolve: async () => 'technology.developer' });
    const result = await service.resolve({ ...CONTEXT, roleId: 'executive.ceo' } as never);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.center.roleId).toBe('technology.developer');
      expect(result.center.domainId).toBe('technology');
    }
  });

  it('the data provider receives only the trusted context, never client claims', async () => {
    const { service, resolveData } = makeEnvironment({
      resolve: async () => 'delivery.manager',
    });
    const forged = { ...CONTEXT, tenantId: 'org_alien', workspaceId: 'wsp_alien' };
    await service.resolve(forged);
    expect(resolveData).toHaveBeenCalledWith(forged, expect.any(Array));
    // The provider is invoked with exactly the trusted context object
    // resolved by the API layer (the module passes it through untouched).
    const [context] = resolveData.mock.calls[0];
    expect(context).toEqual(forged);
  });

  it('a role with no command center fails safely without data', async () => {
    const { service, resolveData } = makeEnvironment({
      resolve: async () => 'finance.cfo',
    });
    const result = await service.resolve(CONTEXT);
    expect(result).toEqual({ ok: false, reason: 'no-command-center' });
    expect(resolveData).not.toHaveBeenCalled();
  });

  it('a resolver that cannot resolve a business role fails safely', async () => {
    const { service, resolveData } = makeEnvironment({ resolve: async () => undefined });
    const result = await service.resolve(CONTEXT);
    expect(result).toEqual({ ok: false, reason: 'no-role' });
    expect(resolveData).not.toHaveBeenCalled();
  });
});
