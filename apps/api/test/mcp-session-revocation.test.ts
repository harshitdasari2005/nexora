/**
 * Tenant-isolation audit F-006 — through the real `/api/mcp` route: an open
 * HTTP MCP session does not keep authority that was revoked after it was
 * created.
 *
 * The CEO opens a session (workspace owner → rich capability set). Their
 * workspace role is then downgraded / removed. The still-open session must stop
 * working on its very next request, and a re-initialized session carries only
 * the current authority. Real SDK client + real listening app.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { WorkspaceMembership } from '@nexora/domain-workspaces';

import {
  buildTestApp,
  login,
  seedOrganization,
  seedOrganizationMembership,
  seedWorkspace,
  seedWorkspaceMembership,
} from './helpers.js';
import type { FakeUserRepository, FakeWorkspaceMembershipRepository } from './fakes.js';

const TENANT = 'org_mcp_revoke';
const WORKSPACE = 'wsp_mcp_revoke';

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  // Reverse: MCP clients close before the app (an open stream blocks app.close()).
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const { app, repos } = await buildTestApp();
  const session = await login(app);
  const userId = [...(repos.users as FakeUserRepository).users.values()][0]!.id;
  await seedOrganization(repos, { id: TENANT, slug: 'mcp-revoke' });
  await seedOrganizationMembership(repos, { organizationId: TENANT, userId, role: 'owner' });
  await seedWorkspace(repos, { id: WORKSPACE, organizationId: TENANT, slug: 'mcp-revoke-ws' });
  await seedWorkspaceMembership(repos, {
    workspaceId: WORKSPACE,
    userId,
    role: 'owner',
    organizationId: TENANT,
  });
  await app.listen({ port: 0 });
  cleanups.push(() => app.close());
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const url = new URL(`http://127.0.0.1:${port}/api/mcp`);
  const headers = { cookie: session, 'x-nexora-workspace': WORKSPACE };

  const connect = async () => {
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
    const client = new Client({ name: 'revocation-test', version: '1.0.0' });
    cleanups.push(() => client.close().catch(() => undefined));
    await client.connect(transport);
    return { client, transport };
  };
  /** A raw request on an existing MCP session id (status only). */
  const raw = async (sessionId: string): Promise<number> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} }),
    });
    await response.text();
    return response.status;
  };
  const membership = (): WorkspaceMembership =>
    [
      ...(repos.workspaceMemberships as FakeWorkspaceMembershipRepository).memberships.values(),
    ].find((m) => m.workspaceId === WORKSPACE && m.userId === userId)!;
  return { repos, connect, raw, membership };
}

describe('HTTP MCP session revocation (route level)', () => {
  it('control: an unchanged session keeps working across requests', async () => {
    const s = await setup();
    const { client, transport } = await s.connect();
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    expect(await s.raw(transport.sessionId as string)).toBe(200);
  });

  it('a role downgrade ends the open session on its next request; a new session has fewer tools', async () => {
    const s = await setup();
    const { client, transport } = await s.connect();
    const before = (await client.listTools()).tools.map((t) => t.name);
    expect(before.length).toBeGreaterThan(0);

    // Trusted state changes: the workspace owner (CEO) is downgraded to member.
    const membership = s.membership();
    expect(membership.changeRole('member')).toBe(true);
    await s.repos.workspaceMemberships.save(membership);

    expect(await s.raw(transport.sessionId as string)).toBe(404);
    await expect(client.listTools()).rejects.toThrow();

    const fresh = await s.connect();
    const after = (await fresh.client.listTools()).tools.map((t) => t.name);
    expect(after.length).toBeLessThan(before.length);
    expect(after.every((name) => before.includes(name))).toBe(true);
  });

  it('removing the workspace membership blocks the open session AND any new one (403)', async () => {
    const s = await setup();
    const { transport } = await s.connect();
    (s.repos.workspaceMemberships as FakeWorkspaceMembershipRepository).memberships.delete(
      s.membership().id,
    );
    expect(await s.raw(transport.sessionId as string)).toBe(403);
    await expect(s.connect()).rejects.toThrow();
  });
});
