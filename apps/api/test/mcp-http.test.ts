/**
 * S24 Phase 6 — authenticated remote MCP (streamable HTTP) tests.
 *
 * Builds the REAL Fastify app over the in-memory fakes, LISTENS on a real
 * port, and connects with the OFFICIAL MCP SDK `Client` over the
 * `StreamableHTTPClientTransport` — a real HTTP client against the real
 * route (not InMemoryTransport). Verifies:
 * - No anonymous access: unauthenticated MCP requests → 401.
 * - Tenant/workspace are derived server-side: a foreign workspace header →
 *   403; the client can never supply identity.
 * - Capability-aware discovery per authenticated role (CEO sees governed
 *   writes; Developer does not), and a guessed write tool is not callable.
 * - Governed write end-to-end: MCP call → APPROVAL_REQUIRED → approve
 *   through the EXISTING /api/ai/approvals/:id/decision route → resume →
 *   execution → verification → exactly-once (a replay never creates a
 *   second event).
 * - Session binding: a session created by user A is rejected for user B
 *   (no cross-user session hijacking).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OidcGateway, OidcIdentity } from '../src/oidc/gateway.js';
import type { RepositorySet } from '../src/container.js';
import {
  buildTestApp,
  login,
  seedOrganization,
  seedOrganizationMembership,
  seedWorkspace,
  seedWorkspaceMembership,
} from './helpers.js';
import { FakeOidcGateway } from './fakes.js';
import type { FakeCalendarEntryRepository, FakeUserRepository } from './fakes.js';

const TENANT = 'org_mcp';
const WORKSPACE = 'wsp_mcp_eng';

/** Rotates between two OIDC identities — one per login (two distinct users). */
class MultiIdentityOidcGateway extends FakeOidcGateway {
  readonly identities: OidcIdentity[];
  private index = 0;

  constructor(identities: OidcIdentity[]) {
    super(identities[0]);
    this.identities = identities;
  }

  override async exchangeCode(
    ...args: Parameters<OidcGateway['exchangeCode']>
  ): Promise<OidcIdentity> {
    const identity = this.identities[this.index % this.identities.length]!;
    this.index += 1;
    void args;
    return identity;
  }
}

describe('authenticated remote MCP (streamable HTTP over /api/mcp)', () => {
  let app: FastifyInstance;
  let repos: RepositorySet;
  let baseUrl: string;
  let ceoSession: string;
  let devSession: string;
  let ceoUserId: string;
  let devUserId: string;
  /** Clients created by `mcpClient` — closed in afterEach. */
  const openClients: { client: Client; transport: StreamableHTTPClientTransport }[] = [];

  beforeAll(async () => {
    const oidc = new MultiIdentityOidcGateway([
      {
        subject: 'sub-ceo-6',
        email: 'ceo@nexora.dev',
        emailVerified: true,
        displayName: 'CEO Morgan',
        issuer: 'http://keycloak.test/realms/nexora',
      },
      {
        subject: 'sub-dev-6',
        email: 'dev@nexora.dev',
        emailVerified: true,
        displayName: 'Dev Lee',
        issuer: 'http://keycloak.test/realms/nexora',
      },
    ]);
    const built = await buildTestApp({ oidc });
    app = built.app;
    repos = built.repos;

    // Two authenticated sessions: the CEO (owner) and the Developer (member).
    ceoSession = await login(app);
    devSession = await login(app);
    const users = [...(repos.users as FakeUserRepository).users.values()];
    ceoUserId = users[0]!.id;
    devUserId = users[1]!.id;

    // Trusted memberships (the MCP surface derives identity from these).
    await seedOrganization(repos, { id: TENANT, slug: 'mcp-acme' });
    await seedOrganizationMembership(repos, {
      organizationId: TENANT,
      userId: ceoUserId,
      role: 'owner',
    });
    await seedOrganizationMembership(repos, {
      organizationId: TENANT,
      userId: devUserId,
      role: 'member',
    });
    await seedWorkspace(repos, { id: WORKSPACE, organizationId: TENANT, slug: 'mcp-eng' });
    await seedWorkspaceMembership(repos, {
      workspaceId: WORKSPACE,
      userId: ceoUserId,
      role: 'owner',
      organizationId: TENANT,
    });
    await seedWorkspaceMembership(repos, {
      workspaceId: WORKSPACE,
      userId: devUserId,
      role: 'member',
      organizationId: TENANT,
    });

    // REAL HTTP: listen on an ephemeral port.
    await app.listen({ port: 0 });
    const address = app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/mcp`;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    for (const entry of openClients.splice(0)) {
      try {
        await entry.client.close();
      } catch {
        // Closing an already-closed client is harmless.
      }
    }
  });

  /** Builds a real MCP SDK client with the session cookie + workspace header. */
  function mcpClient(
    session: string,
    options: { workspace?: string; captureSessionId?: boolean } = {},
  ): {
    client: Client;
    transport: StreamableHTTPClientTransport;
    capturedSessionIds: string[];
  } {
    const capturedSessionIds: string[] = [];
    const headers: Record<string, string> = { cookie: session };
    if (options.workspace !== undefined) {
      headers['x-nexora-workspace'] = options.workspace;
    }
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers },
      ...(options.captureSessionId === true
        ? {
            fetch: async (
              input: Parameters<typeof fetch>[0],
              init?: Parameters<typeof fetch>[1],
            ) => {
              const response = await fetch(input, init);
              const sessionId = response.headers.get('mcp-session-id');
              if (sessionId !== null) {
                capturedSessionIds.push(sessionId);
              }
              return response;
            },
          }
        : {}),
    });
    const client = new Client({ name: 'nexora-test-client', version: '1.0.0' });
    openClients.push({ client, transport });
    return { client, transport, capturedSessionIds };
  }

  /** The MCP initialize JSON-RPC body (raw HTTP tests). */
  function initializeBody(id: number): Record<string, unknown> {
    return {
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        clientInfo: { name: 'raw-test', version: '1.0.0' },
      },
    };
  }

  it('rejects unauthenticated MCP requests with 401 (no anonymous access)', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(initializeBody(1)),
    });
    expect(response.status).toBe(401);
  });

  it('rejects a forged workspace header with 403 (membership is the access rule)', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: ceoSession,
        'x-nexora-workspace': 'wsp_foreign',
      },
      body: JSON.stringify(initializeBody(1)),
    });
    expect(response.status).toBe(403);
  });

  it('authenticated CEO initializes over real HTTP and sees the governed write surface', async () => {
    const { client, transport } = mcpClient(ceoSession, { workspace: WORKSPACE });
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'nexora.projects.list',
        'nexora.projects.get',
        'nexora.documents.search',
        'nexora.knowledge.search',
        'nexora.notifications.list',
        'nexora.calendar.create_event',
        'nexora.projects.create',
      ]),
    );
  });

  it('authenticated Developer does NOT see write tools and cannot call them', async () => {
    const { client, transport } = mcpClient(devSession, { workspace: WORKSPACE });
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toContain('nexora.projects.list');
    expect(names).not.toContain('nexora.calendar.create_event');
    expect(names).not.toContain('nexora.projects.create');

    // A guessed write tool is indistinguishable from a nonexistent one.
    const result = await client.callTool({
      name: 'nexora.calendar.create_event',
      arguments: {
        title: 'Hacked',
        startsAt: '2026-08-16T10:00:00Z',
        endsAt: '2026-08-16T11:00:00Z',
      },
    });
    const structured = (result.structuredContent ?? {}) as { code?: string; status?: string };
    expect(structured.code ?? structured.status).toBe('TOOL_NOT_FOUND');
  });

  it('governed write end-to-end: MCP → approval via the API route → execute → verify → exactly-once', async () => {
    const { client, transport } = mcpClient(ceoSession, { workspace: WORKSPACE });
    await client.connect(transport);

    const events = repos.calendarEvents as FakeCalendarEntryRepository;
    const args = {
      title: 'Payments Review',
      startsAt: '2026-08-16T10:00:00Z',
      endsAt: '2026-08-16T11:00:00Z',
    };
    const countByTitle = () =>
      [...events.entries.values()].filter((entry) => entry.title.value === 'Payments Review')
        .length;

    // 1. The write is gated: nothing is created, a durable approval opens.
    const first = await client.callTool({ name: 'nexora.calendar.create_event', arguments: args });
    const firstStructured = (first.structuredContent ?? {}) as {
      status?: string;
      approvalId?: string;
    };
    expect(firstStructured.status).toBe('approval_required');
    const approvalId = firstStructured.approvalId as string;
    expect(approvalId).toMatch(/^apr_/);
    expect(countByTitle()).toBe(0);

    // 2. Approve through the EXISTING approval route (cross-process
    //    governance: the API process decides the MCP-opened approval).
    const decision = await app.inject({
      method: 'POST',
      url: `/api/ai/approvals/${approvalId}/decision`,
      headers: { cookie: ceoSession, 'content-type': 'application/json' },
      payload: { decision: 'approve' },
    });
    expect(decision.statusCode).toBe(200);

    // 3. The MCP client resumes the SAME action → executes + verifies.
    const resumed = await client.callTool({
      name: 'nexora.calendar.create_event',
      arguments: args,
    });
    const resumedStructured = (resumed.structuredContent ?? {}) as {
      event?: { title: string; status: string };
    };
    expect(resumedStructured.event).toMatchObject({
      title: 'Payments Review',
      status: 'scheduled',
    });
    expect(countByTitle()).toBe(1);

    // 4. A replayed delivery replays the stored result — never a second event.
    await client.callTool({ name: 'nexora.calendar.create_event', arguments: args });
    expect(countByTitle()).toBe(1);
  });

  it('binds a session to its authenticated owner — a different user cannot reuse it', async () => {
    // The CEO creates the session; capture the MCP session id.
    const { client, transport, capturedSessionIds } = mcpClient(ceoSession, {
      workspace: WORKSPACE,
      captureSessionId: true,
    });
    await client.connect(transport);
    expect(capturedSessionIds.length).toBeGreaterThan(0);
    const sessionId = capturedSessionIds[0]!;

    // The Developer reuses the CEO session id with their OWN cookie: the
    // session belongs to another user — rejected (no hijacking).
    const hijack = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: devSession,
        'x-nexora-workspace': WORKSPACE,
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    expect(hijack.status).toBe(403);
  });

  it('an unknown MCP session id fails safely (client re-initializes)', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: ceoSession,
        'x-nexora-workspace': WORKSPACE,
        'mcp-session-id': 'mcp_does_not_exist',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    expect(response.status).toBe(404);
  });
});
