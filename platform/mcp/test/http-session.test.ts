/**
 * Tenant-isolation audit F-006 — HTTP MCP sessions do not outlive the
 * authority they were created with.
 *
 * Before: a session cached its trusted context (role + capability set) for
 * its whole lifetime, with no expiry. Now every request to an existing session
 * re-resolves the trusted USER authority (identity, scope, role/domain, agent
 * binding) and the session is terminated (404 → the client re-initializes with
 * CURRENT authority) the moment it differs; idle sessions expire. Delegation
 * narrowing stays with the per-call executor check. Real SDK client over a real HTTP server; deterministic
 * clock.
 */

import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import {
  NexoraMCPServer,
  type NexoraMCPContext,
  type NexoraMCPHandleHttpIdentity,
  type NexoraMCPTool,
} from '../src/index.js';

function tool(name: string, requiredCapability: string): NexoraMCPTool {
  return {
    definition: {
      name,
      description: name,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      requiredCapability,
      operationType: 'read',
      requiresApproval: false,
    },
    handle: async () => ({ ok: true, output: {} }),
  };
}

const TOOLS = [tool('nexora.test.read', 'test.read'), tool('nexora.test.admin', 'test.admin')];
const IDENTITY: NexoraMCPHandleHttpIdentity = { userId: 'usr_1', tenantId: 'org_1' };

interface Harness {
  server: NexoraMCPServer;
  url: URL;
  /** The authority the server will resolve from "trusted state" right now. */
  authority: { capabilityIds: string[]; businessRole: string | undefined; agentId?: string };
  clock: { now: number };
  connect(): Promise<{ client: Client; transport: StreamableHTTPClientTransport }>;
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  // Reverse order: clients close first, then connections, then the server
  // (closing a server with a live MCP stream open never resolves).
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function harness(sessionIdleTtlMs = 60_000): Promise<Harness> {
  const clock = { now: 1_000_000 };
  const authority: Harness['authority'] = {
    capabilityIds: ['test.read', 'test.admin'],
    businessRole: 'executive.ceo',
  };
  const server = new NexoraMCPServer({
    name: 'nexora-test',
    version: '0.0.0',
    tools: TOOLS,
    sessionIdleTtlMs,
    now: () => clock.now,
  });
  const resolveContext = async (): Promise<NexoraMCPContext> => ({
    userId: IDENTITY.userId,
    tenantId: IDENTITY.tenantId,
    ...(authority.businessRole === undefined ? {} : { businessRole: authority.businessRole }),
    capabilityIds: [...authority.capabilityIds],
    correlationId: `corr_${Math.random()}`, // differs every call: must NOT count as a change
    ...(authority.agentId === undefined
      ? {}
      : { agent: { agentId: authority.agentId, definitionId: 'def', name: 'agent' } }),
  });
  const httpServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw.length === 0 ? undefined : (JSON.parse(raw) as unknown);
      void server.handleHttpRequest(req, res, body, { identity: IDENTITY, resolveContext });
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  cleanups.push(() => new Promise<void>((resolve) => httpServer.close(() => resolve())));
  cleanups.push(() => httpServer.closeAllConnections());
  return {
    server,
    url,
    authority,
    clock,
    async connect() {
      const transport = new StreamableHTTPClientTransport(url);
      const client = new Client({ name: 'session-test', version: '1.0.0' });
      cleanups.push(() => client.close().catch(() => undefined));
      await client.connect(transport);
      return { client, transport };
    },
  };
}

/** A raw tools/list request bound to an existing session id. */
async function rawListTools(url: URL, sessionId: string): Promise<number> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }),
  });
  await response.text();
  return response.status;
}

describe('HTTP MCP session authority (F-006)', () => {
  it('control: unchanged authority keeps the session alive across requests', async () => {
    const h = await harness();
    const { client, transport } = await h.connect();
    expect((await client.listTools()).tools).toHaveLength(2);
    expect((await client.listTools()).tools).toHaveLength(2);
    expect(h.server.httpSessionCount()).toBe(1);
    expect(await rawListTools(h.url, transport.sessionId as string)).toBe(200);
  });

  it('a role downgrade (its capabilities revoked with it) terminates the open session on its next request; a new session sees only current authority', async () => {
    const h = await harness();
    const { client, transport } = await h.connect();
    const sessionId = transport.sessionId as string;
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
      'nexora.test.admin',
      'nexora.test.read',
    ]);

    // Trusted state changes: the role is downgraded and loses the admin capability.
    h.authority.businessRole = 'technology.developer';
    h.authority.capabilityIds = ['test.read'];

    // The still-open session must NOT keep exercising the old authority.
    expect(await rawListTools(h.url, sessionId)).toBe(404);
    expect(h.server.httpSessionCount()).toBe(0);
    await expect(client.listTools()).rejects.toThrow();

    // Re-initializing yields a session with CURRENT authority only.
    const fresh = await h.connect();
    expect((await fresh.client.listTools()).tools.map((t) => t.name)).toEqual(['nexora.test.read']);
  });

  it('delegation-derived capability narrowing alone does NOT end the session — the executor enforces it per call', async () => {
    const h = await harness();
    const { transport } = await h.connect();
    h.authority.capabilityIds = ['test.read']; // same role, same agent binding
    expect(await rawListTools(h.url, transport.sessionId as string)).toBe(200);
    expect(h.server.httpSessionCount()).toBe(1);
  });

  it('an agent delegation change (agent binding) ends the session', async () => {
    const h = await harness();
    h.authority.agentId = 'agt_1';
    const { transport } = await h.connect();
    expect(await rawListTools(h.url, transport.sessionId as string)).toBe(200);
    h.authority.agentId = undefined; // binding no longer resolves to the same agent
    expect(await rawListTools(h.url, transport.sessionId as string)).toBe(404);
  });

  it('total revocation (membership gone → no business role at all) ends the session and exposes nothing', async () => {
    const h = await harness();
    const { transport } = await h.connect();
    h.authority.businessRole = undefined;
    h.authority.capabilityIds = [];
    expect(await rawListTools(h.url, transport.sessionId as string)).toBe(404);
    const fresh = await h.connect();
    expect((await fresh.client.listTools()).tools).toEqual([]);
  });

  it('idle sessions expire; activity within the TTL keeps a session alive', async () => {
    const h = await harness(1_000);
    const { transport } = await h.connect();
    const sessionId = transport.sessionId as string;

    h.clock.now += 900;
    expect(await rawListTools(h.url, sessionId)).toBe(200); // refreshes lastSeen
    h.clock.now += 900;
    expect(await rawListTools(h.url, sessionId)).toBe(200); // 900ms since last use: alive
    h.clock.now += 1_500;
    expect(await rawListTools(h.url, sessionId)).toBe(404); // idle past the TTL
    expect(h.server.httpSessionCount()).toBe(0);
  });

  it('abandoned sessions are swept when any later request arrives (bounded accumulation)', async () => {
    const h = await harness(1_000);
    await h.connect();
    await h.connect();
    expect(h.server.httpSessionCount()).toBe(2);
    h.clock.now += 5_000;
    await h.connect(); // a new initialize triggers the sweep of the two stale sessions
    expect(h.server.httpSessionCount()).toBe(1);
  });
});
