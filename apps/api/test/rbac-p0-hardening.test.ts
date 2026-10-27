/**
 * P0 security hardening — RBAC capability-gating tests for the resource
 * routes newly gated beyond org/workspace membership (Projects, Employees,
 * Documents, Knowledge reads, Workflows, Calendar, Activity). Follows the
 * exact pattern established in `rbac-permissions.test.ts`: a role WITH the
 * required capability succeeds, a role WITHOUT it is rejected with 403, a
 * forged role/capability/organization claim in the request is ignored, and
 * cross-tenant access fails before RBAC is even consulted.
 *
 * `onboardOrgAndWorkspace`'s org creator becomes the workspace `owner`; the
 * workspace `type` selects which business role that owner resolves to (see
 * `business-role-resolver.ts`'s per-domain override table):
 * - `engineering` (default) → `executive.ceo` — the broadest read+write set.
 * - `finance` → `finance.cfo` — read-heavy, no employees/workflows/calendar/
 *   documents.upload reach (the clean "read does not imply write" case).
 * - `legal` (owner tier) → `legal.general_counsel` — holds `documents.upload`,
 *   one of only two roles in the whole catalog that does.
 */

import { describe, expect, it } from 'vitest';

import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  seedOrganization,
  seedOrganizationMembership,
  seedWorkspace,
  seedWorkspaceMembership,
} from './helpers.js';

/**
 * Seeds a fresh organization where the current test user is a `member`
 * (not the `owner` `onboardOrgAndWorkspace` always creates) — resolves to
 * `technology.developer` at the ORGANIZATION level (the default mapping's
 * `member` tier). Used for the org-scoped-only routes (Projects, Employees,
 * Workflows), which call `authorizePermission` WITHOUT a `workspaceId` — so
 * a workspace's `type` never affects their resolution, only the caller's
 * organization membership role does.
 */
async function seedMemberOrg(
  client: Awaited<ReturnType<typeof chatClient>>,
  organizationId: string,
): Promise<void> {
  await seedOrganization(client.repos, {
    id: organizationId,
    slug: organizationId.replace(/_/g, '-'),
  });
  await seedOrganizationMembership(client.repos, {
    organizationId,
    userId: currentUserId(client),
    role: 'member',
  });
}

describe('P0 hardening — Projects (projects.create / projects.read)', () => {
  it('a CEO (holds both) can create and list projects', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const created = await client.post('/api/projects', {
      organizationId,
      name: 'Mobile Banking',
    });
    expect(created.statusCode).toBe(201);

    const list = await client.get(`/api/projects?organizationId=${organizationId}`);
    expect(list.statusCode).toBe(200);
  });

  it('a Developer (org member tier: projects.read but NOT projects.create) can list but not create — read never implies write', async () => {
    const client = await chatClient();
    const organizationId = 'org_dev_projects_test';
    await seedMemberOrg(client, organizationId);

    const list = await client.get(`/api/projects?organizationId=${organizationId}`);
    expect(list.statusCode).toBe(200);

    const created = await client.post('/api/projects', {
      organizationId,
      name: 'Sneaky Project',
    });
    expect(created.statusCode).toBe(403);
    expect(created.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
  });

  it('a forged role/capability claim in the body never grants the missing capability', async () => {
    const client = await chatClient();
    const organizationId = 'org_dev_projects_forge_test';
    await seedMemberOrg(client, organizationId);

    const forged = await client.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: client.session, 'content-type': 'application/json' },
      payload: {
        organizationId,
        name: 'Forged Project',
        role: 'executive.ceo',
        capability: 'projects.create',
      },
    });
    expect(forged.statusCode).toBe(403);
  });

  it('a real CEO of one tenant cannot create a project in a foreign tenant', async () => {
    const client = await chatClient();
    await onboardOrgAndWorkspace(client);

    const foreign = await client.post('/api/projects', {
      organizationId: 'org_alien',
      name: 'Cross Tenant Project',
    });
    expect(foreign.statusCode).toBe(403);
  });
});

describe('P0 hardening — Employees (employees.manage / employees.read)', () => {
  it('a CEO (holds both) can create and list employees', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const created = await client.post('/api/employees', {
      organizationId,
      name: 'Asha Verma',
    });
    expect(created.statusCode).toBe(201);

    const list = await client.get(`/api/employees?organizationId=${organizationId}`);
    expect(list.statusCode).toBe(200);
  });

  it('a Developer (org member tier: neither capability) is rejected with 403 on both read and write', async () => {
    const client = await chatClient();
    const organizationId = 'org_dev_employees_test';
    await seedMemberOrg(client, organizationId);

    const created = await client.post('/api/employees', {
      organizationId,
      name: 'Sneaky Hire',
    });
    expect(created.statusCode).toBe(403);

    const list = await client.get(`/api/employees?organizationId=${organizationId}`);
    expect(list.statusCode).toBe(403);
  });
});

describe('P0 hardening — Documents (documents.read / documents.upload)', () => {
  it('an HR Manager (documents.read only) can list but not upload — read never implies write', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'hr',
    });

    const list = await client.get(
      `/api/documents?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(list.statusCode).toBe(200);

    const uploaded = await client.post('/api/documents', {
      organizationId,
      workspaceId,
      title: 'Sneaky Upload.txt',
      contentType: 'text/plain',
      content: Buffer.from('sneaky').toString('base64'),
    });
    expect(uploaded.statusCode).toBe(403);
    expect(uploaded.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
  });

  it('a General Counsel (holds documents.upload) can upload', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'legal',
    });

    const uploaded = await client.post('/api/documents', {
      organizationId,
      workspaceId,
      title: 'Contract.txt',
      contentType: 'text/plain',
      content: Buffer.from('terms').toString('base64'),
    });
    expect(uploaded.statusCode).toBe(201);
  });

  it('a real CEO of one tenant cannot read documents in a foreign tenant', async () => {
    const client = await chatClient();
    const { workspaceId } = await onboardOrgAndWorkspace(client);

    const foreign = await client.get(
      `/api/documents?organizationId=org_alien&workspaceId=${workspaceId}`,
    );
    expect(foreign.statusCode).toBe(403);
  });
});

describe('P0 hardening — Knowledge reads (knowledge.read)', () => {
  it('a CEO (holds knowledge.read) can list articles', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const list = await client.get(
      `/api/knowledge/articles?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(list.statusCode).toBe(200);
  });

  it('a role with NO catalog capabilities (Compliance Manager, admin tier of a legal workspace) is rejected with 403', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });
    const userId = currentUserId(client);

    // Admin tier of a `legal`-typed workspace resolves to
    // `legal.compliance_manager`, whose capabilityIds is deliberately empty.
    const workspaceId = 'wsp_compliance_test';
    await seedWorkspace(client.repos, {
      id: workspaceId,
      organizationId,
      slug: 'compliance-test',
      type: 'legal',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId,
      userId,
      role: 'admin',
      organizationId,
    });

    const list = await client.get(
      `/api/knowledge/articles?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(list.statusCode).toBe(403);
    expect(list.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
  });

  it('a forged capability claim in the query never grants the missing capability', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });
    const userId = currentUserId(client);

    const workspaceId = 'wsp_compliance_forge_test';
    await seedWorkspace(client.repos, {
      id: workspaceId,
      organizationId,
      slug: 'compliance-forge-test',
      type: 'legal',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId,
      userId,
      role: 'admin',
      organizationId,
    });

    const forged = await client.app.inject({
      method: 'GET',
      url: `/api/knowledge/articles?organizationId=${organizationId}&workspaceId=${workspaceId}&capability=knowledge.read&role=executive.ceo`,
      headers: { cookie: client.session },
    });
    expect(forged.statusCode).toBe(403);
  });
});

describe('P0 hardening — Workflows (workflows.read / workflows.execute)', () => {
  it('a CEO (holds both) can list and start workflows', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const list = await client.get(`/api/workflows?organizationId=${organizationId}`);
    expect(list.statusCode).toBe(200);

    const started = await client.post('/api/workflows', {
      organizationId,
      definitionKey: 'demo.workflow',
      input: {},
    });
    // Membership + capability both pass here; a 400 (unknown definition) is
    // an acceptable business-logic outcome — 403 is what this test forbids.
    expect(started.statusCode).not.toBe(403);
  });

  it('a Developer (org member tier: workflows.read but NOT workflows.execute) can list but not start — read never implies write', async () => {
    const client = await chatClient();
    const organizationId = 'org_dev_workflows_test';
    await seedMemberOrg(client, organizationId);

    const list = await client.get(`/api/workflows?organizationId=${organizationId}`);
    expect(list.statusCode).toBe(200);

    const started = await client.post('/api/workflows', {
      organizationId,
      definitionKey: 'demo.workflow',
      input: {},
    });
    expect(started.statusCode).toBe(403);
  });
});

describe('P0 hardening — Calendar (calendar.read / calendar.create)', () => {
  it('a CEO (holds both) can create and list calendar events', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const created = await client.post('/api/calendar/events', {
      organizationId,
      workspaceId,
      title: 'Board Meeting',
      startsAt: '2026-09-01T10:00:00.000Z',
      endsAt: '2026-09-01T11:00:00.000Z',
    });
    expect(created.statusCode).toBe(201);

    const list = await client.get(
      `/api/calendar/events?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(list.statusCode).toBe(200);
  });

  it('a CFO (holds neither) is rejected with 403 on both create and list', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'finance',
    });

    const created = await client.post('/api/calendar/events', {
      organizationId,
      workspaceId,
      title: 'Sneaky Meeting',
      startsAt: '2026-09-01T10:00:00.000Z',
      endsAt: '2026-09-01T11:00:00.000Z',
    });
    expect(created.statusCode).toBe(403);

    const list = await client.get(
      `/api/calendar/events?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(list.statusCode).toBe(403);
  });
});

describe('P0 hardening — Activity feed (activity.read)', () => {
  it('a CEO (holds activity.read) can read the workspace activity feed', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const activity = await client.get(
      `/api/activity?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(activity.statusCode).toBe(200);
  });

  it('a role with NO catalog capabilities is rejected with 403', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });
    const userId = currentUserId(client);

    const workspaceId = 'wsp_activity_compliance_test';
    await seedWorkspace(client.repos, {
      id: workspaceId,
      organizationId,
      slug: 'activity-compliance-test',
      type: 'legal',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId,
      userId,
      role: 'admin',
      organizationId,
    });

    const activity = await client.get(
      `/api/activity?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(activity.statusCode).toBe(403);
  });

  it('the personal notification inbox stays reachable for a role with no business capabilities (self-scoped, not capability-gated)', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });
    const userId = currentUserId(client);

    const workspaceId = 'wsp_notif_compliance_test';
    await seedWorkspace(client.repos, {
      id: workspaceId,
      organizationId,
      slug: 'notif-compliance-test',
      type: 'legal',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId,
      userId,
      role: 'admin',
      organizationId,
    });

    const inbox = await client.get(
      `/api/notifications?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(inbox.statusCode).toBe(200);
  });
});
