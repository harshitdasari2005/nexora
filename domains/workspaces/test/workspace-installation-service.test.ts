/**
 * WorkspaceInstallationService tests: install/remove flows with
 * workspace-status gating and duplicate detection.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import {
  PluginAlreadyInstalledError,
  PluginNotFoundError,
  PluginVersionUnchangedError,
  WorkspaceArchivedError,
  WorkspaceNotFoundError,
  WorkspaceNotActiveError,
} from '../src/errors/index.js';
import { WORKSPACE_EVENT_TYPES } from '../src/events/index.js';
import { WorkspaceDomainService } from '../src/services/workspace-domain-service.js';
import { WorkspaceInstallationService } from '../src/services/workspace-installation-service.js';
import { WorkspaceId } from '../src/value-objects/workspace-id.js';
import {
  InMemoryWorkspaceInstallationRepository,
  InMemoryWorkspaceRepository,
  testContext,
} from './helpers.js';

const ORGANIZATION = 'tenant_1' as TenantId;
const context = testContext();

async function createService() {
  const workspaces = new InMemoryWorkspaceRepository();
  const installations = new InMemoryWorkspaceInstallationRepository();
  const workspaceService = new WorkspaceDomainService({ workspaces });
  const service = new WorkspaceInstallationService({ installations, workspaces });
  return { workspaces, installations, workspaceService, service };
}

async function createActiveWorkspace(
  workspaceService: WorkspaceDomainService,
): Promise<WorkspaceId> {
  const created = await workspaceService.create(
    { organizationId: ORGANIZATION, slug: 'eng', name: 'Engineering', type: 'engineering' },
    context,
  );
  if (!created.ok) throw new Error('create failed');
  const activated = await workspaceService.activate(created.value.workspace.id, context);
  if (!activated.ok) throw new Error('activate failed');
  return activated.value.workspace.id;
}

describe('WorkspaceInstallationService.installPlugin', () => {
  it('installs a plugin in an active workspace and emits PluginInstalled', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    const result = await service.installPlugin(id, 'plugin-hr', '1.2.0', context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.installation.pluginId).toBe('plugin-hr');
    expect(result.value.installation.pluginVersion).toBe('1.2.0');
    expect(result.value.events.map((event) => event.type)).toEqual([
      WORKSPACE_EVENT_TYPES.pluginInstalled,
    ]);
  });

  it('fails when the workspace does not exist', async () => {
    const { service } = await createService();
    const result = await service.installPlugin(WorkspaceId.create(), 'plugin-hr', '1.0.0', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('fails when the workspace is not active', async () => {
    const { service, workspaceService } = await createService();
    const created = await workspaceService.create(
      { organizationId: ORGANIZATION, slug: 'eng', name: 'E', type: 'engineering' },
      context,
    );
    if (!created.ok) return;
    const result = await service.installPlugin(
      created.value.workspace.id,
      'plugin-hr',
      '1.0.0',
      context,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceNotActiveError);
  });

  it('fails when the workspace is archived', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await workspaceService.archive(id, 'done', context);
    const result = await service.installPlugin(id, 'plugin-hr', '1.0.0', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceArchivedError);
  });

  it('fails when the plugin is already installed', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.installPlugin(id, 'plugin-hr', '1.0.0', context);
    const result = await service.installPlugin(id, 'plugin-hr', '2.0.0', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PluginAlreadyInstalledError);
  });

  it('allows installing two different plugins', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.installPlugin(id, 'plugin-hr', '1.0.0', context);
    const second = await service.installPlugin(id, 'plugin-finance', '1.0.0', context);
    expect(second.ok).toBe(true);
  });
});

describe('WorkspaceInstallationService.removePlugin', () => {
  it('removes a plugin and emits PluginRemoved', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.installPlugin(id, 'plugin-hr', '1.0.0', context);
    const result = await service.removePlugin(id, 'plugin-hr', context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events.map((event) => event.type)).toEqual([
      WORKSPACE_EVENT_TYPES.pluginRemoved,
    ]);
  });

  it('removes the installation from the repository', async () => {
    const { service, workspaceService, installations } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.installPlugin(id, 'plugin-hr', '1.0.0', context);
    await service.removePlugin(id, 'plugin-hr', context);
    const remaining = await installations.listByWorkspace(id);
    expect(remaining).toHaveLength(0);
  });

  it('fails when the plugin is not installed', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    const result = await service.removePlugin(id, 'plugin-missing', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PluginNotFoundError);
  });

  it('fails when the workspace is archived', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.installPlugin(id, 'plugin-hr', '1.0.0', context);
    await workspaceService.archive(id, 'done', context);
    const result = await service.removePlugin(id, 'plugin-hr', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceArchivedError);
  });
});

describe('WorkspaceInstallationService.updatePlugin', () => {
  it('upgrades the plugin version, keeps the installation identity, and emits PluginUpdated', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.installPlugin(id, 'plugin-hr', '1.0.0', context);

    const result = await service.updatePlugin(id, 'plugin-hr', '2.0.0', context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.installation.pluginVersion).toBe('2.0.0');
    expect(result.value.events.map((event) => event.type)).toEqual([
      WORKSPACE_EVENT_TYPES.pluginUpdated,
    ]);
    const updated = result.value.events[0];
    if (updated === undefined) return;
    const payload = updated.payload as { previousVersion?: string; pluginVersion?: string };
    expect(payload.previousVersion).toBe('1.0.0');
    expect(payload.pluginVersion).toBe('2.0.0');
  });

  it('persists the new version (the upgrade is durable)', async () => {
    const { service, workspaceService, installations } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.installPlugin(id, 'plugin-hr', '1.0.0', context);
    await service.updatePlugin(id, 'plugin-hr', '2.0.0', context);

    const installed = await installations.findByWorkspaceAndPlugin(id, 'plugin-hr');
    expect(installed?.pluginVersion).toBe('2.0.0');
    // The installation identity is retained across the upgrade.
    expect(installed?.installedAt).toBeDefined();
  });

  it('fails when the plugin is not installed', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    const result = await service.updatePlugin(id, 'plugin-missing', '2.0.0', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PluginNotFoundError);
  });

  it('rejects a same-version update (the version bump is the audit trail)', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.installPlugin(id, 'plugin-hr', '1.0.0', context);

    const result = await service.updatePlugin(id, 'plugin-hr', '1.0.0', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PluginVersionUnchangedError);
  });

  it('fails when the workspace is archived', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.installPlugin(id, 'plugin-hr', '1.0.0', context);
    await workspaceService.archive(id, 'done', context);
    const result = await service.updatePlugin(id, 'plugin-hr', '2.0.0', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceArchivedError);
  });
});

describe('WorkspaceInstallationService.listByWorkspace', () => {
  it('lists the installations of a workspace', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.installPlugin(id, 'plugin-hr', '1.0.0', context);
    await service.installPlugin(id, 'plugin-crm', '2.0.0', context);
    const result = await service.listByWorkspace(id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
  });

  it('fails for a missing workspace', async () => {
    const { service } = await createService();
    const result = await service.listByWorkspace(WorkspaceId.create());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceNotFoundError);
  });
});
