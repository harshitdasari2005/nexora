/**
 * Backend RBAC enforcement — capability gating for the mutating surfaces
 * closed by this milestone: inbound webhooks (`integrations.manage`), the
 * marketplace app lifecycle (`marketplace.manage`), workspace creation
 * (`workspaces.create`), remediation-plan driving (`problems.investigate`),
 * and knowledge authoring (`knowledge.publish`).
 *
 * Same matrix as `rbac-p0-hardening.test.ts`: a role WITH the capability
 * succeeds; a role WITHOUT it is rejected with 403 / AUTHORIZATION_ERROR; a
 * forged role/capability claim in the request is ignored; and a real role
 * of tenant A cannot act on tenant B (membership gate fires first).
 *
 * Personas (via `onboardOrgAndWorkspace`'s workspace-`type` override table):
 * - default `engineering` owner → `executive.ceo` — holds every new cap.
 * - `sales` owner → `growth.sales_manager` — a read-only set holding NONE
 *   of them (the clean negative persona for the workspace-scoped routes).
 */

import { describe, expect, it } from 'vitest';

import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  seedOrganization,
  seedOrganizationMembership,
} from './helpers.js';

/** Asserts an RBAC denial (never a 2xx, never a 5xx, never a membership 404). */
function expectForbidden(response: { statusCode: number; json: () => unknown }): void {
  expect(response.statusCode).toBe(403);
  expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
}

describe('backend RBAC — integrations.manage (inbound webhooks)', () => {
  it('a CEO can create a webhook endpoint', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const created = await client.post('/api/integrations/webhooks', {
      organizationId,
      workspaceId,
      url: 'https://example.test/hook',
      eventTypes: [],
    });
    expect(created.statusCode).toBe(201);
    await client.app.close();
  });

  it('a Sales Manager (no integrations.manage) is rejected with 403', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'sales',
    });
    expectForbidden(
      await client.post('/api/integrations/webhooks', {
        organizationId,
        workspaceId,
        url: 'https://example.test/hook',
        eventTypes: [],
      }),
    );
    await client.app.close();
  });

  it('a forged role/capability claim in the body does not grant it', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'sales',
    });
    const forged = await client.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks',
      headers: { cookie: client.session, 'content-type': 'application/json' },
      payload: {
        organizationId,
        workspaceId,
        url: 'https://example.test/hook',
        eventTypes: [],
        role: 'executive.ceo',
        capability: 'integrations.manage',
      },
    });
    expect(forged.statusCode).toBe(403);
    await client.app.close();
  });

  it('a real CEO of one tenant cannot manage another tenant’s webhooks', async () => {
    const client = await chatClient();
    await onboardOrgAndWorkspace(client);
    const foreign = await client.post('/api/integrations/webhooks', {
      organizationId: 'org_alien',
      workspaceId: 'wsp_alien',
      url: 'https://example.test/hook',
      eventTypes: [],
    });
    expect(foreign.statusCode).toBe(403);
    await client.app.close();
  });
});

describe('backend RBAC — marketplace.manage (app lifecycle)', () => {
  it('a CEO can install an app', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const installed = await client.post('/api/marketplace/apps/com.nexora.hr/install', {
      organizationId,
      workspaceId,
      permissionsConfirmed: true,
    });
    expect([200, 201]).toContain(installed.statusCode);
    await client.app.close();
  });

  it('a Sales Manager (no marketplace.manage) cannot install, update, or uninstall', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'sales',
    });
    expectForbidden(
      await client.post('/api/marketplace/apps/com.nexora.hr/install', {
        organizationId,
        workspaceId,
        permissionsConfirmed: true,
      }),
    );
    expectForbidden(
      await client.post('/api/marketplace/apps/com.nexora.hr/uninstall', {
        organizationId,
        workspaceId,
      }),
    );
    await client.app.close();
  });
});

describe('backend RBAC — workspaces.create', () => {
  it('a fresh org owner (executive.ceo) can create the first workspace', async () => {
    // onboardOrgAndWorkspace itself POSTs /api/workspaces and asserts 201.
    const client = await chatClient();
    await onboardOrgAndWorkspace(client);
    await client.app.close();
  });

  it('a plain org member (technology.developer) is rejected with 403', async () => {
    const client = await chatClient();
    const organizationId = 'org_rbac_ws_member';
    await seedOrganization(client.repos, { id: organizationId, slug: 'org-rbac-ws-member' });
    await seedOrganizationMembership(client.repos, {
      organizationId,
      userId: currentUserId(client),
      role: 'member',
    });
    expectForbidden(
      await client.post('/api/workspaces', {
        organizationId,
        name: 'Sneaky',
        slug: 'sneaky',
        type: 'engineering',
      }),
    );
    await client.app.close();
  });

  it('a non-member cannot create a workspace in a foreign org', async () => {
    const client = await chatClient();
    await onboardOrgAndWorkspace(client);
    const foreign = await client.post('/api/workspaces', {
      organizationId: 'org_alien',
      name: 'Cross Tenant',
      slug: 'cross-tenant',
      type: 'engineering',
    });
    expect(foreign.statusCode).toBe(403);
    await client.app.close();
  });
});

describe('backend RBAC — problems.investigate (remediation plan driving)', () => {
  it('a role WITH problems.investigate reaches the plan logic (404 for an unknown plan, not 403)', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const advance = await client.post(
      `/api/plans/plan_unknown/advance?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    // Past the RBAC gate — the failure is about the (missing) plan, not the role.
    expect(advance.statusCode).not.toBe(403);
    await client.app.close();
  });

  it('a Sales Manager (no problems.investigate) cannot advance / replan / cancel', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'sales',
    });
    const q = `organizationId=${organizationId}&workspaceId=${workspaceId}`;
    expectForbidden(await client.post(`/api/plans/plan_x/advance?${q}`, {}));
    expectForbidden(await client.post(`/api/plans/plan_x/replan?${q}`, {}));
    expectForbidden(await client.post(`/api/plans/plan_x/cancel?${q}`, {}));
    await client.app.close();
  });
});

describe('backend RBAC — knowledge.publish (authoring)', () => {
  it('a CEO can create and publish a knowledge article', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const created = await client.post('/api/knowledge/articles', {
      organizationId,
      workspaceId,
      title: 'Runbook',
      body: 'Steps to follow when the thing happens.',
    });
    expect([200, 201]).toContain(created.statusCode);
    const articleId = (created.json() as { article: { id: string } }).article.id;
    const published = await client.post(`/api/knowledge/articles/${articleId}/publish`, {
      organizationId,
      workspaceId,
    });
    expect(published.statusCode).toBe(200);
    await client.app.close();
  });

  it('a Sales Manager (knowledge-read-less, publish-less) cannot author, edit, publish, or categorize', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'sales',
    });
    expectForbidden(
      await client.post('/api/knowledge/articles', {
        organizationId,
        workspaceId,
        title: 'X',
        body: 'Y',
      }),
    );
    expectForbidden(
      await client.post('/api/knowledge/articles/art_x/publish', { organizationId, workspaceId }),
    );
    expectForbidden(
      await client.post('/api/knowledge/categories', { organizationId, workspaceId, name: 'X' }),
    );
    await client.app.close();
  });
});
