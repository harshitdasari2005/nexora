/**
 * S19 marketplace use-case tests: install (permission review gate), update,
 * uninstall, catalog browse, and installed-apps read — via the
 * {@link WorkspaceApplicationService}.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import {
  MarketplaceAppNotFoundError,
  PermissionReviewRequiredError,
  WorkspaceDomainService,
  WorkspaceInstallationService,
  WorkspaceMembershipService,
  WORKSPACE_EVENT_TYPES,
} from '@nexora/domain-workspaces';

import type { PluginManifest } from '@nexora/contracts/plugin';

import type { InstallAppCommand } from '../src/commands/install-app.command.js';
import { WorkspaceApplicationService } from '../src/services/workspace-application-service.js';
import { AppCatalog, FIRST_PARTY_APP_MANIFESTS } from '../src/marketplace/app-catalog.js';
import {
  InMemoryWorkspaceInstallationRepository,
  InMemoryWorkspaceMembershipRepository,
  InMemoryWorkspaceRepository,
  RecordingEventPublisher,
} from './helpers.js';

const ORG = 'org_acme' as TenantId;
const ACTOR = 'usr_alex' as UserId;

function makeEnvironment() {
  const workspaces = new InMemoryWorkspaceRepository();
  const memberships = new InMemoryWorkspaceMembershipRepository();
  const installations = new InMemoryWorkspaceInstallationRepository();
  const publisher = new RecordingEventPublisher();
  const catalog = new AppCatalog();

  const workspacesService = new WorkspaceDomainService({ workspaces });
  const membershipsService = new WorkspaceMembershipService({ memberships, workspaces });
  const installationsService = new WorkspaceInstallationService({ installations, workspaces });
  const service = new WorkspaceApplicationService({
    workspacesService,
    membershipsService,
    installationsService,
    catalog,
    publisher,
  });
  return {
    service,
    workspaces,
    memberships,
    installations,
    publisher,
    catalog,
    workspacesService,
    membershipsService,
    installationsService,
  };
}

async function createActiveWorkspace(
  workspacesService: WorkspaceDomainService,
): Promise<WorkspaceId> {
  const context = {
    actor: { kind: 'user' as const, id: ACTOR },
    correlationId: 'corr_ws',
    organizationId: ORG,
  };
  const created = await workspacesService.create(
    { organizationId: ORG, slug: 'eng', name: 'Engineering', type: 'engineering' },
    context,
  );
  if (!created.ok) throw new Error('create failed');
  const activated = await workspacesService.activate(created.value.workspace.id, context);
  if (!activated.ok) throw new Error('activate failed');
  return activated.value.workspace.id;
}

function installCommand(
  workspaceId: WorkspaceId,
  overrides: Partial<InstallAppCommand> = {},
): InstallAppCommand {
  return {
    organizationId: ORG,
    workspaceId,
    appId: 'com.nexora.hr',
    permissionsConfirmed: true,
    actorId: ACTOR,
    correlationId: 'corr_install',
    ...overrides,
  };
}

describe('WorkspaceApplicationService.installApp', () => {
  it('installs a catalog app after permission review and publishes the event', async () => {
    const { service, workspacesService, installations, publisher } = makeEnvironment();
    const workspaceId = await createActiveWorkspace(workspacesService);

    const result = await service.installApp(installCommand(workspaceId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const saved = await installations.findByWorkspaceAndPlugin(workspaceId, 'com.nexora.hr');
    expect(saved?.pluginVersion).toBe('1.0.0');
    expect(publisher.types).toEqual([WORKSPACE_EVENT_TYPES.pluginInstalled]);
  });

  it('rejects an install whose permission review is not confirmed', async () => {
    const { service, workspacesService } = makeEnvironment();
    const workspaceId = await createActiveWorkspace(workspacesService);

    const result = await service.installApp(
      installCommand(workspaceId, { permissionsConfirmed: false }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PermissionReviewRequiredError);
  });

  it('rejects an unknown catalog app', async () => {
    const { service, workspacesService } = makeEnvironment();
    const workspaceId = await createActiveWorkspace(workspacesService);

    const result = await service.installApp(
      installCommand(workspaceId, { appId: 'com.alien.app' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(MarketplaceAppNotFoundError);
  });

  it('publishes nothing when the install is rejected', async () => {
    const { service, workspacesService, publisher } = makeEnvironment();
    const workspaceId = await createActiveWorkspace(workspacesService);
    await service.installApp(installCommand(workspaceId, { permissionsConfirmed: false }));
    expect(publisher.types).toHaveLength(0);
  });
});

describe('WorkspaceApplicationService.updateApp', () => {
  it('upgrades the app to the catalog version and publishes PluginUpdated', async () => {
    const {
      installations,
      publisher,
      workspacesService,
      membershipsService,
      installationsService,
    } = makeEnvironment();
    const workspaceId = await createActiveWorkspace(workspacesService);
    const base = new WorkspaceApplicationService({
      workspacesService,
      membershipsService,
      installationsService,
      publisher,
    });
    await base.installApp(installCommand(workspaceId));

    // Simulate a catalog release: HR advances to v2.0.0 in a custom catalog.
    const hrV2: PluginManifest = {
      ...FIRST_PARTY_APP_MANIFESTS[0]!,
      version: '2.0.0',
    };
    const upgraded = new WorkspaceApplicationService({
      workspacesService,
      membershipsService,
      installationsService,
      catalog: new AppCatalog([hrV2]),
      publisher,
    });

    const result = await upgraded.updateApp({
      organizationId: ORG,
      workspaceId,
      appId: 'com.nexora.hr',
      actorId: ACTOR,
      correlationId: 'corr_update',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.previousVersion).toBe('1.0.0');
    expect(result.value.updatedVersion).toBe('2.0.0');
    // The update publishes its own event AFTER the install event.
    expect(publisher.types).toEqual([
      WORKSPACE_EVENT_TYPES.pluginInstalled,
      WORKSPACE_EVENT_TYPES.pluginUpdated,
    ]);
    const saved = await installations.findByWorkspaceAndPlugin(workspaceId, 'com.nexora.hr');
    expect(saved?.pluginVersion).toBe('2.0.0');
  });

  it('rejects updating an app that is not installed', async () => {
    const { service, workspacesService } = makeEnvironment();
    const workspaceId = await createActiveWorkspace(workspacesService);
    const result = await service.updateApp({
      organizationId: ORG,
      workspaceId,
      appId: 'com.nexora.hr',
      actorId: ACTOR,
      correlationId: 'corr_update',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown catalog app', async () => {
    const { service, workspacesService } = makeEnvironment();
    const workspaceId = await createActiveWorkspace(workspacesService);
    const result = await service.updateApp({
      organizationId: ORG,
      workspaceId,
      appId: 'com.alien.app',
      actorId: ACTOR,
      correlationId: 'corr_update',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(MarketplaceAppNotFoundError);
  });
});

describe('WorkspaceApplicationService.uninstallApp', () => {
  it('uninstalls an app and publishes PluginRemoved', async () => {
    const { service, workspacesService, installations, publisher } = makeEnvironment();
    const workspaceId = await createActiveWorkspace(workspacesService);
    await service.installApp(installCommand(workspaceId));

    const result = await service.uninstallApp({
      organizationId: ORG,
      workspaceId,
      appId: 'com.nexora.hr',
      actorId: ACTOR,
      correlationId: 'corr_uninstall',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The uninstall publishes its own event AFTER the install event.
    expect(publisher.types).toEqual([
      WORKSPACE_EVENT_TYPES.pluginInstalled,
      WORKSPACE_EVENT_TYPES.pluginRemoved,
    ]);
    const remaining = await installations.listByWorkspace(workspaceId);
    expect(remaining).toHaveLength(0);
  });
});

describe('WorkspaceApplicationService.listMarketplaceApps', () => {
  it('lists the catalog with installed state per workspace', async () => {
    const { service, workspacesService } = makeEnvironment();
    const workspaceId = await createActiveWorkspace(workspacesService);
    await service.installApp(installCommand(workspaceId));

    const result = await service.listMarketplaceApps(workspaceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(FIRST_PARTY_APP_MANIFESTS.length);
    const hr = result.value.find((app) => app.id === 'com.nexora.hr');
    expect(hr?.installed).toBe(true);
    expect(hr?.installedVersion).toBe('1.0.0');
    expect(hr?.requiredPermissions).toContain('hr:read');
    const projects = result.value.find((app) => app.id === 'com.nexora.projects');
    expect(projects?.installed).toBe(false);
  });
});

describe('WorkspaceApplicationService.listInstalledApps', () => {
  it('lists installed apps with update availability', async () => {
    const { service, workspacesService } = makeEnvironment();
    const workspaceId = await createActiveWorkspace(workspacesService);
    await service.installApp(installCommand(workspaceId));

    const result = await service.listInstalledApps(workspaceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const hr = result.value[0];
    expect(hr?.appId).toBe('com.nexora.hr');
    expect(hr?.name).toBe('HR');
    expect(hr?.version).toBe('1.0.0');
    expect(hr?.latestVersion).toBe('1.0.0');
    expect(hr?.updateAvailable).toBe(false);
  });
});
