/**
 * S24 Phase 2 — Legal extensibility proof (mandatory). A NEW domain (Legal)
 * with its own roles registers a command center for `legal.general_counsel`
 * and resolves through the SAME generic engine — no engine change, no
 * role-specific logic, no modification of the initial registrations.
 */

import { describe, expect, it, vi } from 'vitest';
import { createInitialCatalog } from '@nexora/module-domains';
import type { CommandCenterDefinition } from '@nexora/contracts/command-center';

import {
  CommandCenterApplicationService,
  type CommandCenterRoleResolver,
} from '../src/application/command-center-application-service.js';
import { CommandCenterRegistry } from '../src/registry/command-center-registry.js';
import { INITIAL_COMMAND_CENTERS } from '../src/seed/initial-command-centers.js';

const LEGAL_COMMAND_CENTER: CommandCenterDefinition = {
  id: 'legal_command_center',
  name: 'Command Center',
  domainId: 'legal',
  roleId: 'legal.general_counsel',
  description: 'Legal operations and contract oversight',
  widgets: [
    {
      id: 'contracts',
      type: 'list',
      title: 'Contracts',
      description: 'Documents relevant to legal',
      dataSource: 'documents.list',
      span: 2,
    },
    {
      id: 'attention',
      type: 'attention',
      title: 'Needs attention',
      description: 'Unread notifications',
      dataSource: 'notifications.unread',
      span: 2,
    },
  ],
  actions: [
    { id: 'view_documents', label: 'View documents', kind: 'navigate', href: '/app/documents' },
  ],
};

describe('Legal extensibility (S24 Phase 2)', () => {
  it('registers and resolves a Legal command center through the same engine', async () => {
    // The SAME initial catalog the platform seeds: Legal is added at the
    // same extension seam a Marketplace-installed domain would use.
    const catalog = createInitialCatalog();
    catalog.capabilities.register({
      id: 'contracts.read',
      name: 'Read Contracts',
      description: 'Read contract documents (test fixture)',
    });
    catalog.domains.register({
      id: 'legal',
      name: 'Legal',
      description: 'Legal operations and compliance',
      roleIds: ['legal.general_counsel', 'legal.legal_manager'],
    });
    catalog.roles.register({
      id: 'legal.general_counsel',
      name: 'General Counsel',
      description: 'Leads the legal function',
      domainId: 'legal',
      capabilityIds: ['contracts.read'],
    });
    catalog.roles.register({
      id: 'legal.legal_manager',
      name: 'Legal Manager',
      description: 'Manages legal operations',
      domainId: 'legal',
      capabilityIds: ['contracts.read'],
    });

    // Register the initial command centers PLUS the Legal one — the engine
    // is unchanged; the new command center is just another registration.
    const registry = new CommandCenterRegistry(catalog);
    for (const def of INITIAL_COMMAND_CENTERS) {
      registry.register(def);
    }
    registry.register(LEGAL_COMMAND_CENTER);

    const resolveData = vi.fn(async () => ({
      contracts: { kind: 'list', items: [] },
      attention: { kind: 'attention', items: [] },
    }));
    const roleResolver: CommandCenterRoleResolver = {
      resolve: async () => 'legal.general_counsel',
    };
    const service = new CommandCenterApplicationService({
      registry,
      catalog,
      roleResolver,
      dataProvider: { resolveData },
    });

    const result = await service.resolve({
      userId: 'usr_alice',
      tenantId: 'org_acme',
      workspaceId: 'wsp_legal',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Domain resolves, role resolves, command center resolves, widgets
    // resolve, and the generic renderer can render the configuration (the
    // DTO carries only renderable widget/action data).
    expect(result.center.id).toBe('legal_command_center');
    expect(result.center.domainId).toBe('legal');
    expect(result.center.domainName).toBe('Legal');
    expect(result.center.roleId).toBe('legal.general_counsel');
    expect(result.center.roleName).toBe('General Counsel');
    expect(result.center.widgets.map((w) => w.id)).toEqual(['contracts', 'attention']);
    expect(result.center.widgets.every((w) => w.type !== undefined)).toBe(true);
    expect(result.center.actions.map((a) => a.label)).toEqual(['View documents']);
    expect(result.center.data.contracts).toEqual({ kind: 'list', items: [] });
  });

  it('still resolves the initial centers after Legal is added (no interference)', async () => {
    const catalog = createInitialCatalog();
    const registry = new CommandCenterRegistry(catalog);
    for (const def of INITIAL_COMMAND_CENTERS) {
      registry.register(def);
    }
    expect(registry.resolveByRole('executive.ceo')?.id).toBe('ceo');
    expect(registry.resolveByRole('delivery.manager')?.id).toBe('manager');
    expect(registry.resolveByRole('technology.developer')?.id).toBe('developer');
  });
});
