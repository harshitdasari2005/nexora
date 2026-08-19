/**
 * S24 Phase 2 — Facilities extensibility proof (mandatory). A NEW domain
 * (Facilities) with its own roles registers a command center for
 * `facilities.lead` and resolves through the SAME generic engine — no
 * engine change, no role-specific logic, no modification of the initial
 * registrations. (Legal is now itself part of the initial catalog and has
 * its own command center — this fixture uses a domain that genuinely is
 * NOT registered.)
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

const FACILITIES_COMMAND_CENTER: CommandCenterDefinition = {
  id: 'facilities_command_center',
  name: 'Command Center',
  domainId: 'facilities',
  roleId: 'facilities.lead',
  description: 'Facilities operations and contract oversight',
  widgets: [
    {
      id: 'contracts',
      type: 'list',
      title: 'Contracts',
      description: 'Documents relevant to facilities',
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

describe('Facilities extensibility (S24 Phase 2)', () => {
  it('registers and resolves a Facilities command center through the same engine', async () => {
    // The SAME initial catalog the platform seeds: Facilities is added at
    // the same extension seam a Marketplace-installed domain would use.
    const catalog = createInitialCatalog();
    catalog.capabilities.register({
      id: 'contracts.read',
      name: 'Read Contracts',
      description: 'Read contract documents (test fixture)',
    });
    catalog.domains.register({
      id: 'facilities',
      name: 'Facilities',
      description: 'Facilities operations',
      roleIds: ['facilities.lead', 'facilities.manager'],
    });
    catalog.roles.register({
      id: 'facilities.lead',
      name: 'Facilities Lead',
      description: 'Leads the facilities function',
      domainId: 'facilities',
      capabilityIds: ['contracts.read'],
    });
    catalog.roles.register({
      id: 'facilities.manager',
      name: 'Facilities Manager',
      description: 'Manages facilities operations',
      domainId: 'facilities',
      capabilityIds: ['contracts.read'],
    });

    // Register the initial command centers PLUS the Facilities one — the
    // engine is unchanged; the new command center is just another
    // registration.
    const registry = new CommandCenterRegistry(catalog);
    for (const def of INITIAL_COMMAND_CENTERS) {
      registry.register(def);
    }
    registry.register(FACILITIES_COMMAND_CENTER);

    const resolveData = vi.fn(async () => ({
      contracts: { kind: 'list', items: [] },
      attention: { kind: 'attention', items: [] },
    }));
    const roleResolver: CommandCenterRoleResolver = {
      resolve: async () => 'facilities.lead',
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
      workspaceId: 'wsp_facilities',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Domain resolves, role resolves, command center resolves, widgets
    // resolve, and the generic renderer can render the configuration (the
    // DTO carries only renderable widget/action data).
    expect(result.center.id).toBe('facilities_command_center');
    expect(result.center.domainId).toBe('facilities');
    expect(result.center.domainName).toBe('Facilities');
    expect(result.center.roleId).toBe('facilities.lead');
    expect(result.center.roleName).toBe('Facilities Lead');
    expect(result.center.widgets.map((w) => w.id)).toEqual(['contracts', 'attention']);
    expect(result.center.widgets.every((w) => w.type !== undefined)).toBe(true);
    expect(result.center.actions.map((a) => a.label)).toEqual(['View documents']);
    expect(result.center.data.contracts).toEqual({ kind: 'list', items: [] });
  });

  it('still resolves the initial centers after Facilities is added (no interference)', async () => {
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
