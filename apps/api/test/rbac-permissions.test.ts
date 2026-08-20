/**
 * S34 — RBAC permission-resolution + enforcement tests.
 *
 * Two layers:
 * 1. Unit tests for the authoritative permission-resolution seam
 *    (`apps/api/src/business-context/permissions.ts`) — pure, no server.
 * 2. HTTP tests (`fastify.inject`) proving the NEW route-level enforcement
 *    on problems/agent/insights/approval-decision actually gates real
 *    requests: a role with the permission is allowed, a role without it is
 *    rejected with 403, and a forged role/capability/organization claim in
 *    the request is ignored — the effective permission set always comes
 *    from trusted membership → the SAME resolver every other surface uses.
 */

import { describe, expect, it } from 'vitest';

import type { MembershipBusinessRoleResolver } from '../src/business-context/business-role-resolver.js';
import {
  authorizePermission,
  resolveEffectivePermissions,
} from '../src/business-context/permissions.js';
import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  seedWorkspace,
  seedWorkspaceMembership,
} from './helpers.js';

function fakeCatalog(role: { domainId: string; capabilityIds: readonly string[] } | undefined) {
  return {
    roles: { get: () => role },
  } as never;
}

function fakeResolver(roleId: string | undefined): MembershipBusinessRoleResolver {
  return { resolve: async () => roleId } as never;
}

describe('permission resolution (unit)', () => {
  it('resolves the effective permission set from the trusted role', async () => {
    const result = await resolveEffectivePermissions(
      {
        roleResolver: fakeResolver('finance.cfo'),
        catalog: fakeCatalog({
          domainId: 'finance',
          capabilityIds: ['insights.read', 'problems.read'],
        }),
      },
      { userId: 'usr_1', tenantId: 'org_1' },
    );
    expect(result).toEqual({
      roleId: 'finance.cfo',
      domainId: 'finance',
      permissions: ['insights.read', 'problems.read'],
    });
  });

  it('returns undefined when no role resolves (no membership)', async () => {
    const result = await resolveEffectivePermissions(
      { roleResolver: fakeResolver(undefined), catalog: fakeCatalog(undefined) },
      { userId: 'usr_1', tenantId: 'org_1' },
    );
    expect(result).toBeUndefined();
  });

  it('authorizes when the permission is present', async () => {
    const result = await authorizePermission(
      {
        roleResolver: fakeResolver('technology.developer'),
        catalog: fakeCatalog({ domainId: 'technology', capabilityIds: ['problems.read'] }),
      },
      { userId: 'usr_1', tenantId: 'org_1' },
      'problems.read',
    );
    expect(result.ok).toBe(true);
  });

  it('denies (fail-closed) when the permission is absent — even for a non-empty set', async () => {
    const result = await authorizePermission(
      {
        roleResolver: fakeResolver('technology.developer'),
        catalog: fakeCatalog({ domainId: 'technology', capabilityIds: ['problems.read'] }),
      },
      { userId: 'usr_1', tenantId: 'org_1' },
      'calendar.create',
    );
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('denies (fail-closed) when no role resolves at all', async () => {
    const result = await authorizePermission(
      { roleResolver: fakeResolver(undefined), catalog: fakeCatalog(undefined) },
      { userId: 'usr_1', tenantId: 'org_1' },
      'problems.read',
    );
    expect(result).toEqual({ ok: false, reason: 'no-role' });
  });
});

describe('RBAC route enforcement (HTTP)', () => {
  it('a CEO (full permission set) can read problems, view the agent, and read insights', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const problems = await client.get(
      `/api/problems?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(problems.statusCode).toBe(200);

    const agent = await client.get(
      `/api/agent?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(agent.statusCode).toBe(200);

    const insights = await client.get(
      `/api/insights?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(insights.statusCode).toBe(200);
  });

  it('an HR role (lacks agent.execute, insights.read, problems.investigate) is rejected with 403 on those routes', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const userId = currentUserId(client);

    const hrWorkspaceId = 'wsp_hr_rbac_test';
    await seedWorkspace(client.repos, {
      id: hrWorkspaceId,
      organizationId,
      slug: 'hr-rbac-test',
      type: 'hr',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: hrWorkspaceId,
      userId,
      role: 'owner',
      organizationId,
    });

    // people.hr HAS `agent.use`, so the RBAC check itself must pass here —
    // the response is 404 only because no agent is REGISTERED for
    // people.hr (a business-logic fact, not a permission denial; a 403
    // here would mean the wrong thing was rejected).
    const getAgent = await client.get(
      `/api/agent?organizationId=${organizationId}&workspaceId=${hrWorkspaceId}`,
    );
    expect(getAgent.statusCode).toBe(404);
    expect(getAgent.json().error.message).toContain('No agent is configured');

    const execute = await client.post(
      `/api/agent/execute?organizationId=${organizationId}&workspaceId=${hrWorkspaceId}`,
      { utterance: 'do something' },
    );
    expect(execute.statusCode).toBe(403);
    expect(execute.json().error.code).toBe('AUTHORIZATION_ERROR');

    // people.hr lacks `insights.read`.
    const insights = await client.get(
      `/api/insights?organizationId=${organizationId}&workspaceId=${hrWorkspaceId}`,
    );
    expect(insights.statusCode).toBe(403);

    // people.hr has `problems.read` (list allowed) but NOT
    // `problems.investigate` (single-problem detail rejected).
    const list = await client.get(
      `/api/problems?organizationId=${organizationId}&workspaceId=${hrWorkspaceId}`,
    );
    expect(list.statusCode).toBe(200);
    const detail = await client.get(
      `/api/problems/prb_nonexistent?organizationId=${organizationId}&workspaceId=${hrWorkspaceId}`,
    );
    expect(detail.statusCode).toBe(403);
  });

  it('IMPORTANT SECURITY TEST: a forged role/capability/organization claim never grants elevated access', async () => {
    // A Developer-scoped caller (owner of a `general`-typed workspace, per
    // the S33 technology-domain override, resolves to `technology.developer`
    // at the member tier — here the default engineering workspace's OWNER
    // tier already gives `executive.ceo`, so use an HR workspace instead to
    // get a role that genuinely lacks `agent.execute` and `insights.read`,
    // then attempt to forge past it.
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const userId = currentUserId(client);

    const hrWorkspaceId = 'wsp_hr_forge_test';
    await seedWorkspace(client.repos, {
      id: hrWorkspaceId,
      organizationId,
      slug: 'hr-forge-test',
      type: 'hr',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: hrWorkspaceId,
      userId,
      role: 'owner',
      organizationId,
    });

    // Forge a CEO role claim, a capability claim, and a foreign organization
    // id in the query/body — the route never reads any of them; only the
    // trusted (userId, tenantId, workspaceId) resolution is consulted.
    const forged = await client.app.inject({
      method: 'GET',
      url: `/api/insights?organizationId=${organizationId}&workspaceId=${hrWorkspaceId}&role=executive.ceo&capability=insights.read&asRole=CEO`,
      headers: { cookie: client.session },
    });
    expect(forged.statusCode).toBe(403);

    const forgedExecute = await client.app.inject({
      method: 'POST',
      url: `/api/agent/execute?organizationId=${organizationId}&workspaceId=${hrWorkspaceId}`,
      headers: { cookie: client.session, 'content-type': 'application/json' },
      payload: {
        utterance: 'do something',
        role: 'executive.ceo',
        capability: 'agent.execute',
        organizationId: 'foreign-org-claim',
      },
    });
    expect(forgedExecute.statusCode).toBe(403);
  });

  it('a foreign workspace id (real permission, wrong scope) is rejected with 403 before RBAC is even consulted', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    // The caller IS a genuine CEO of `organizationId` — but never a member
    // of this workspace. Workspace-membership scope is verified BEFORE the
    // RBAC permission check, so this fails on scope, not permission.
    const foreignWorkspace = await client.get(
      `/api/insights?organizationId=${organizationId}&workspaceId=wsp_foreign_test`,
    );
    expect(foreignWorkspace.statusCode).toBe(403);

    const foreignAgent = await client.get(
      `/api/agent?organizationId=${organizationId}&workspaceId=wsp_foreign_test`,
    );
    expect(foreignAgent.statusCode).toBe(403);
  });
});
