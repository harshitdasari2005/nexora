/**
 * Dashboard scope regression — `GET /api/dashboard` selects its workspace
 * from the caller's OWN memberships. It never defaults to the org's first
 * workspace, never echoes a workspace the caller is not a member of (even
 * when `workspaceId` is forged), and returns `workspace: null` without a
 * workspace membership.
 */

import { describe, expect, it } from 'vitest';

import {
  chatClientWithSecondUser,
  currentUserId,
  onboardOrgAndWorkspace,
  seedOrganization,
  seedWorkspace,
  seedWorkspaceMembership,
} from './helpers.js';

interface Dashboard {
  organization: { id: string } | null;
  workspace: { id: string } | null;
}

async function setup() {
  const client = await chatClientWithSecondUser();
  const { organizationId, workspaceId: executiveId } = await onboardOrgAndWorkspace(client);
  const financeId = 'wsp_finance_scope';
  await seedWorkspace(client.repos, {
    id: financeId,
    organizationId,
    slug: 'finance-scope',
    type: 'finance',
  });
  return { client, organizationId, executiveId, financeId };
}

describe('GET /api/dashboard workspace scope', () => {
  it('defaults a finance-only member to THEIR workspace, not the org first workspace', async () => {
    const { client, organizationId, executiveId, financeId } = await setup();
    await client.second.join({ organizationId, workspaceId: financeId, workspaceRole: 'member' });
    const body = (await client.second.get('/api/dashboard')).json() as Dashboard;
    expect(body.workspace?.id).toBe(financeId);
    expect(body.workspace?.id).not.toBe(executiveId);
  });

  it('ignores a forged / non-member workspaceId (no leak of the foreign workspace)', async () => {
    const { client, organizationId, executiveId, financeId } = await setup();
    await client.second.join({ organizationId, workspaceId: financeId, workspaceRole: 'member' });
    for (const forged of [executiveId, 'wsp_does_not_exist']) {
      const response = await client.second.get(
        `/api/dashboard?organizationId=${organizationId}&workspaceId=${forged}`,
      );
      expect(response.statusCode).toBe(200);
      const body = response.json() as Dashboard;
      expect(body.workspace?.id).toBe(financeId);
      expect(JSON.stringify(body)).not.toContain(executiveId);
    }
  });

  it('honours an explicit workspaceId only when the caller is a member of it', async () => {
    const { client, organizationId, financeId } = await setup();
    const url = `/api/dashboard?organizationId=${organizationId}&workspaceId=${financeId}`;
    // Not (yet) a member of the finance workspace: the id is ignored.
    const before = (await client.get(url)).json() as Dashboard;
    expect(before.workspace?.id).not.toBe(financeId);
    await seedWorkspaceMembership(client.repos, {
      workspaceId: financeId,
      userId: currentUserId(client),
      role: 'owner',
      organizationId,
    });
    const after = (await client.get(url)).json() as Dashboard;
    expect(after.workspace?.id).toBe(financeId);
  });

  it('returns workspace null for an org member with no workspace membership', async () => {
    const { client, organizationId, executiveId } = await setup();
    await client.second.join({ organizationId, workspaceId: 'wsp_none', workspaceRole: 'member' });
    // join() seeded a membership for a non-existent workspace id; it never resolves.
    const body = (
      await client.second.get(`/api/dashboard?workspaceId=${executiveId}`)
    ).json() as Dashboard;
    expect(body.workspace?.id).not.toBe(executiveId);
    expect(body.workspace).toBeNull();
  });

  it('never selects another tenant organization or workspace (second org)', async () => {
    const { client, organizationId } = await setup();
    await seedOrganization(client.repos, { id: 'org_other_tenant', slug: 'other' });
    await seedWorkspace(client.repos, {
      id: 'wsp_other_tenant',
      organizationId: 'org_other_tenant',
      slug: 'other-ws',
    });
    const body = (
      await client.get(
        '/api/dashboard?organizationId=org_other_tenant&workspaceId=wsp_other_tenant',
      )
    ).json() as Dashboard;
    expect(body.organization?.id).toBe(organizationId);
    expect(JSON.stringify(body)).not.toContain('other_tenant');
  });
});
