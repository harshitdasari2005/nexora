/**
 * S27 Phase 6 — role-context API tests (`fastify.inject`).
 *
 * `GET /api/role-context` exposes, for the authenticated caller, the CURRENT
 * resolved business role plus every other (organization, workspace) they are
 * a genuine member of — each annotated with the SAME trusted resolution the
 * Command Center and AI Runtime use. Never a client-supplied list, never a
 * fabricated role.
 */

import { describe, expect, it } from 'vitest';

import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  seedWorkspace,
  seedWorkspaceMembership,
} from './helpers.js';

describe('GET /api/role-context', () => {
  it('rejects unauthenticated access with 401', async () => {
    const client = await chatClient();
    const response = await client.app.inject({ method: 'GET', url: '/api/role-context' });
    expect(response.statusCode).toBe(401);
  });

  it('resolves the CEO role for the owner of the primary (engineering) workspace', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const response = await client.get(
      `/api/role-context?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      current: { roleId: string; roleName: string; domainName: string } | null;
      options: readonly { workspaceId: string; roleId: string }[];
    };
    expect(body.current?.roleId).toBe('executive.ceo');
    expect(body.current?.domainName).toBe('Executive');
    expect(body.options.some((option) => option.workspaceId === workspaceId)).toBe(true);
  });

  it('offers a genuinely different, workspace-type-scoped role for another workspace the caller owns', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId: engineeringWorkspaceId } =
      await onboardOrgAndWorkspace(client);
    const userId = currentUserId(client);

    const legalWorkspaceId = 'wsp_legal_test';
    await seedWorkspace(client.repos, {
      id: legalWorkspaceId,
      organizationId,
      slug: 'legal-test',
      type: 'legal',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: legalWorkspaceId,
      userId,
      role: 'owner',
      organizationId,
    });

    const response = await client.get(`/api/role-context?organizationId=${organizationId}`);
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      options: readonly {
        workspaceId: string;
        roleId: string;
        roleName: string;
        domainName: string;
      }[];
    };
    const engineering = body.options.find((o) => o.workspaceId === engineeringWorkspaceId);
    const legal = body.options.find((o) => o.workspaceId === legalWorkspaceId);
    expect(engineering?.roleId).toBe('executive.ceo');
    expect(legal?.roleId).toBe('legal.general_counsel');
    expect(legal?.domainName).toBe('Legal');
  });

  it('never offers a workspace the caller is not a member of', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const foreignWorkspaceId = 'wsp_foreign_test';
    await seedWorkspace(client.repos, {
      id: foreignWorkspaceId,
      organizationId,
      slug: 'foreign-test',
      type: 'finance',
    });
    // Deliberately NOT seeding a membership for the caller in this workspace.

    const response = await client.get(`/api/role-context?organizationId=${organizationId}`);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { options: readonly { workspaceId: string }[] };
    expect(body.options.some((option) => option.workspaceId === foreignWorkspaceId)).toBe(false);
  });
});
