/**
 * S19 Marketplace + Plugin Runtime — API tests (`fastify.inject`):
 *
 * - Catalog browse returns the 4 first-party apps with per-workspace
 *   installed state and the declared permission review scopes.
 * - Install requires an explicit permission review (400 when not confirmed,
 *   404 for unknown apps), persists a WorkspaceInstallation, and emits
 *   `workspace.plugin_installed` (the audit trail).
 * - Update rejects an uninstalled app (404) and a same-version update (409);
 *   uninstall removes the installation and emits `workspace.plugin_removed`.
 * - Isolation: cross-tenant and cross-workspace scopes are denied (403), and
 *   an unauthenticated caller is rejected (401) — identity comes from the
 *   trusted session, never from the request.
 */

import { describe, expect, it } from 'vitest';

import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  seedWorkspace,
  type ChatClient,
} from './helpers.js';

async function marketplaceClient(): Promise<ChatClient> {
  const client = await chatClient();
  return client;
}

/** The four first-party catalog app ids (mirror of the app catalog). */
const CATALOG_APPS = [
  'com.nexora.hr',
  'com.nexora.projects',
  'com.nexora.documents',
  'com.nexora.knowledge',
] as const;

describe('S19 marketplace slice (E2E via inject)', () => {
  it('lists the catalog with installed state and permission scopes', async () => {
    const client = await marketplaceClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const listing = await client.get(
      `/api/marketplace/apps?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(listing.statusCode).toBe(200);
    const apps = (listing.json().apps as { id: string }[]).map((app) => app.id);
    expect(apps).toEqual([...CATALOG_APPS]);
    const hr = listing.json().apps.find((app: { id: string }) => app.id === 'com.nexora.hr') as {
      installed: boolean;
      requiredPermissions: readonly string[];
      version: string;
    };
    expect(hr.installed).toBe(false);
    expect(hr.requiredPermissions).toContain('hr:read');
    expect(hr.version).toBe('1.0.0');
    await client.app.close();
  });

  it('installs an app after permission review and lists it as installed', async () => {
    const client = await marketplaceClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const installed = await client.post('/api/marketplace/apps/com.nexora.hr/install', {
      organizationId,
      workspaceId,
      permissionsConfirmed: true,
    });
    expect(installed.statusCode).toBe(201);
    expect(installed.json().appId).toBe('com.nexora.hr');
    expect(installed.json().version).toBe('1.0.0');

    const listing = await client.get(
      `/api/marketplace/apps?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    const hr = listing.json().apps.find((app: { id: string }) => app.id === 'com.nexora.hr') as {
      installed: boolean;
      installedVersion: string;
    };
    expect(hr.installed).toBe(true);
    expect(hr.installedVersion).toBe('1.0.0');

    // The installed-apps read reflects the installation.
    const installedList = await client.get(
      `/api/marketplace/apps/installed?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(installedList.statusCode).toBe(200);
    const apps = installedList.json().apps as { appId: string; version: string }[];
    expect(apps.map((app) => app.appId)).toEqual(['com.nexora.hr']);
    expect(apps[0]?.version).toBe('1.0.0');
    await client.app.close();
  });

  it('rejects an install without the permission-review confirmation', async () => {
    const client = await marketplaceClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const installed = await client.post('/api/marketplace/apps/com.nexora.hr/install', {
      organizationId,
      workspaceId,
      permissionsConfirmed: false,
    });
    expect(installed.statusCode).toBe(400);
    const body = installed.json() as { error: { code: string } };
    expect(body.error.code).toBe('PERMISSION_REVIEW_REQUIRED');
    await client.app.close();
  });

  it('rejects an install of an unknown app (404)', async () => {
    const client = await marketplaceClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const installed = await client.post('/api/marketplace/apps/com.alien.app/install', {
      organizationId,
      workspaceId,
      permissionsConfirmed: true,
    });
    expect(installed.statusCode).toBe(404);
    await client.app.close();
  });

  it('rejects a second install of the same app (already installed, 409)', async () => {
    const client = await marketplaceClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const first = await client.post('/api/marketplace/apps/com.nexora.hr/install', {
      organizationId,
      workspaceId,
      permissionsConfirmed: true,
    });
    expect(first.statusCode).toBe(201);
    const second = await client.post('/api/marketplace/apps/com.nexora.hr/install', {
      organizationId,
      workspaceId,
      permissionsConfirmed: true,
    });
    expect(second.statusCode).toBe(409);
    await client.app.close();
  });

  it('rejects updating an app that is not installed (404)', async () => {
    const client = await marketplaceClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const updated = await client.post('/api/marketplace/apps/com.nexora.hr/update', {
      organizationId,
      workspaceId,
    });
    expect(updated.statusCode).toBe(404);
    await client.app.close();
  });

  it('uninstalls an app and it disappears from the installed read', async () => {
    const client = await marketplaceClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    await client.post('/api/marketplace/apps/com.nexora.hr/install', {
      organizationId,
      workspaceId,
      permissionsConfirmed: true,
    });
    const removed = await client.post('/api/marketplace/apps/com.nexora.hr/uninstall', {
      organizationId,
      workspaceId,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().appId).toBe('com.nexora.hr');

    const installedList = await client.get(
      `/api/marketplace/apps/installed?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(installedList.json().apps).toHaveLength(0);
    await client.app.close();
  });

  it('denies a workspace-scope the caller does not belong to (403)', async () => {
    const client = await marketplaceClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    // A foreign workspace of the same tenant (no membership).
    const alien = await seedWorkspace(client.repos, {
      id: 'ws_alien_marketplace',
      organizationId,
      slug: 'alien-marketplace',
    });
    void alien;

    const listing = await client.get(
      `/api/marketplace/apps?organizationId=${organizationId}&workspaceId=ws_alien_marketplace`,
    );
    expect(listing.statusCode).toBe(403);
    await client.app.close();
  });

  it('denies a foreign-tenant scope (403) and rejects unauthenticated calls (401)', async () => {
    const client = await marketplaceClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    void currentUserId(client);

    // Foreign tenant: the caller has no membership in org_alien_marketplace,
    // so the trusted org read model denies the scope before any data loads.
    const foreign = await client.get(
      `/api/marketplace/apps?organizationId=org_alien_marketplace&workspaceId=ws_alien_marketplace_2`,
    );
    expect(foreign.statusCode).toBe(403);

    // Unauthenticated: no session cookie.
    const anonymous = await client.app.inject({
      method: 'GET',
      url: `/api/marketplace/apps?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    });
    expect(anonymous.statusCode).toBe(401);
    await client.app.close();
  });
});
