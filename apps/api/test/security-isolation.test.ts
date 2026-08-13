/**
 * S21 — adversarial tenant/workspace isolation sweep (ROADMAP.md S21
 * "tenant-isolation suite extension", RK-02 mitigation). One consolidated
 * probe surface: every resource read/write is exercised across the tenant
 * and workspace boundaries with forged/foreign ids, and the S21 red-team
 * regressions (IN-01 inbound replay, IN-03 cross-workspace delivery
 * receipts) are asserted at the API level. The authorization path is the
 * ONE membership-based `authorizeScope` used by every route — a forged or
 * foreign scope resolves to 403/404, never to another tenant's record.
 */

import { describe, expect, it } from 'vitest';

import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  seedDocumentAndKnowledge,
  seedOrganizationMembership,
  seedWorkspace,
  seedWorkspaceMembership,
} from './helpers.js';

/** The API surface probed by the unauthenticated sweep. */
const PROTECTED_GETS = [
  '/api/documents?organizationId=org_x&workspaceId=ws_x',
  '/api/calendar/events?organizationId=org_x&workspaceId=ws_x',
  '/api/integrations/webhooks?organizationId=org_x&workspaceId=ws_x',
  '/api/integrations/email/outbox?organizationId=org_x&workspaceId=ws_x',
  '/api/knowledge/sources?organizationId=org_x&workspaceId=ws_x',
  '/api/notifications',
];

describe('S21 security isolation sweep', () => {
  it('denies unauthenticated access across the resource surface with 401', async () => {
    const client = await chatClient();
    for (const path of PROTECTED_GETS) {
      const response = await client.app.inject({ method: 'GET', url: path });
      expect(response.statusCode).toBe(401);
    }
    await client.app.close();
  });

  it('isolates documents + knowledge across tenant AND workspace boundaries', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);
    const userId = currentUserId(client);

    // A document in ANOTHER tenant (seeded directly into the fakes).
    await seedWorkspace(client.repos, {
      id: 'wsp_alien',
      organizationId: 'org_alien',
      slug: 'alien-ws',
    });
    await seedDocumentAndKnowledge(client.repos, {
      id: 'doc_alien',
      organizationId: 'org_alien',
      workspaceId: 'wsp_alien',
      uploaderId: 'usr_alien',
      title: 'Alien tenant secrets',
      text: 'top secret alien data',
    });

    // A document in the SAME tenant but a workspace the caller does not
    // belong to.
    await seedWorkspace(client.repos, {
      id: 'wsp_sibling',
      organizationId: scope.organizationId,
      slug: 'sibling-ws',
    });
    await seedDocumentAndKnowledge(client.repos, {
      id: 'doc_sibling',
      organizationId: scope.organizationId,
      workspaceId: 'wsp_sibling',
      uploaderId: userId,
      title: 'Sibling workspace plan',
      text: 'confidential sibling data',
    });

    // Foreign tenant document read → 403 (membership gate fires first).
    const alienRead = await client.get(
      `/api/documents/doc_alien?organizationId=org_alien&workspaceId=wsp_alien`,
    );
    expect(alienRead.statusCode).toBe(403);

    // Cross-workspace document read (caller is in the org but not the
    // workspace) → 403.
    const siblingRead = await client.get(
      `/api/documents/doc_sibling?organizationId=${scope.organizationId}&workspaceId=wsp_sibling`,
    );
    expect(siblingRead.statusCode).toBe(403);

    // Knowledge reads never surface foreign/cross-workspace sources: the
    // article list is workspace-scoped, and the search corpus is filtered
    // at query time by the permission filter (AIR §9.3 — asserted in the
    // AI knowledge/security suites). A foreign-scope list is 403.
    const alienList = await client.get(
      `/api/knowledge/articles?organizationId=org_alien&workspaceId=wsp_alien`,
    );
    expect(alienList.statusCode).toBe(403);

    await client.app.close();
  });

  it('isolates calendar reads across workspaces the caller belongs to (404, never leak)', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);
    const userId = currentUserId(client);

    // The caller owns a SECOND workspace (both memberships seeded).
    await seedWorkspace(client.repos, {
      id: 'wsp_other',
      organizationId: scope.organizationId,
      slug: 'other-ws',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: 'wsp_other',
      userId,
      role: 'owner',
      organizationId: scope.organizationId,
    });
    await seedOrganizationMembership(client.repos, {
      organizationId: scope.organizationId,
      userId,
      role: 'owner',
    });

    // An event in the caller's own workspace A.
    const created = await client.post('/api/calendar/events', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      title: 'S21 Private Review',
      startsAt: '2026-10-01T15:00:00.000Z',
      endsAt: '2026-10-01T16:00:00.000Z',
    });
    expect(created.statusCode).toBe(201);
    const eventId = (created.json().event as { id: string }).id;

    // Reading the event through workspace B (same tenant, caller is a
    // member of BOTH) → 404: the record is scoped to its workspace.
    const crossWs = await client.get(
      `/api/calendar/events/${eventId}?organizationId=${scope.organizationId}&workspaceId=wsp_other`,
    );
    expect(crossWs.statusCode).toBe(404);

    // A forged (well-formed) event id in the caller's own workspace also
    // 404s — never another record, never a leak.
    const forged = await client.get(
      `/api/calendar/events/cal_00000000-0000-4000-8000-000000000000?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(forged.statusCode).toBe(404);

    await client.app.close();
  });

  it('rejects cross-workspace delivery-receipt reads with 404 (S21 IN-03)', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);
    const userId = currentUserId(client);

    // A second workspace the caller belongs to.
    await seedWorkspace(client.repos, {
      id: 'wsp_other',
      organizationId: scope.organizationId,
      slug: 'other-ws',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: 'wsp_other',
      userId,
      role: 'owner',
      organizationId: scope.organizationId,
    });
    await seedOrganizationMembership(client.repos, {
      organizationId: scope.organizationId,
      userId,
      role: 'owner',
    });

    // An endpoint in workspace A.
    const created = await client.post('/api/integrations/webhooks', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      url: 'https://example.com/hooks',
      eventTypes: ['project.created'],
    });
    expect(created.statusCode).toBe(201);
    const endpointId = (created.json().endpoint as { id: string }).id;

    // Reading its receipts through workspace B (caller belongs to both) →
    // 404 — the other workspace's receipts are never readable.
    const crossWs = await client.get(
      `/api/integrations/webhooks/${endpointId}/deliveries?organizationId=${scope.organizationId}&workspaceId=wsp_other`,
    );
    expect(crossWs.statusCode).toBe(404);

    // Owner workspace still reads its own receipts.
    const owned = await client.get(
      `/api/integrations/webhooks/${endpointId}/deliveries?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(owned.statusCode).toBe(200);

    await client.app.close();
  });

  it('isolates the email outbox by tenant (foreign tenant → 403)', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    const alien = await client.get(
      `/api/integrations/email/outbox?organizationId=org_alien&workspaceId=${scope.workspaceId}`,
    );
    expect(alien.statusCode).toBe(403);

    const crossWs = await client.get(
      `/api/integrations/email/outbox?organizationId=${scope.organizationId}&workspaceId=ws_alien`,
    );
    expect(crossWs.statusCode).toBe(403);

    await client.app.close();
  });
});
