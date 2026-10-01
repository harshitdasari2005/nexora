/**
 * Prompt 4 — agent-bound MCP (streamable HTTP over the REAL `/api/mcp` route).
 *
 * Builds the REAL Fastify app over the in-memory fakes, LISTENS on a real
 * port, and drives it with the OFFICIAL MCP SDK client (session cookie +
 * `X-Nexora-Workspace` + `X-Nexora-Agent`). Verifies:
 * - Session binding: a valid active agent of the caller's workspace narrows
 *   `tools/list` to the agent's effective delegations; a fabricated agent
 *   (AGENT_NOT_FOUND), an agent of another workspace (AGENT_OUT_OF_SCOPE), a
 *   missing workspace header, and a suspended agent (AGENT_SUSPENDED) are all
 *   refused with 403 and audited as blocked security decisions.
 * - Execution-time enforcement: revoking a delegation mid-session fails the
 *   very next call even though the session context was cached.
 * - FORGED_AGENT_CONTEXT: tool arguments naming agentId/delegationId are
 *   blocked and audited.
 * - Governed write AS an agent: the approval is recorded with the agentId,
 *   and the same arguments from a human session or another workspace never
 *   locate (or execute) that approval.
 *
 * Every denial is paired with a positive control so no test passes
 * vacuously.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FakeCalendarEntryRepository } from './fakes.js';
import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  provisionAgent,
  seedWorkspace,
  seedWorkspaceMembership,
  type ChatClient,
} from './helpers.js';

/** The Executive agent's delegations used by the MCP sessions below. */
const AGENT_DELEGATIONS = [
  'projects.find_project',
  'knowledge.search',
  'calendar.create_event',
] as const;

interface AuditEvent {
  source: string;
  status: string;
  detail?: string;
  agent?: { id: string };
  references?: Record<string, string>;
  id: string;
}

describe('agent-bound MCP over the real /api/mcp route', () => {
  let client: ChatClient;
  let baseUrl: string;
  let organizationId: string;
  let workspaceId: string;
  /** A second workspace of the SAME organization the caller is also a member of. */
  const otherWorkspaceId = 'wsp_agent_mcp_other';
  const openClients: Client[] = [];

  beforeAll(async () => {
    client = await chatClient();
    ({ organizationId, workspaceId } = await onboardOrgAndWorkspace(client));
    await seedWorkspace(client.repos, {
      id: otherWorkspaceId,
      organizationId,
      slug: 'agent-mcp-other',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: otherWorkspaceId,
      userId: currentUserId(client),
      role: 'owner',
      organizationId,
    });
    await client.app.listen({ port: 0 });
    const address = client.app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/mcp`;
  });

  afterAll(async () => {
    await client.app.close();
  });

  afterEach(async () => {
    for (const open of openClients.splice(0)) {
      try {
        await open.close();
      } catch {
        // Closing an already-closed client is harmless.
      }
    }
  });

  async function provision(
    options: {
      workspace?: string;
      status?: 'active' | 'suspended' | 'revoked';
      capabilityIds?: readonly string[];
    } = {},
  ): Promise<{ agentId: string; delegationIds: string[] }> {
    return provisionAgent(client.repos, {
      organizationId,
      workspaceId: options.workspace ?? workspaceId,
      definitionId: 'executive',
      grantedBy: currentUserId(client),
      capabilityIds: options.capabilityIds ?? AGENT_DELEGATIONS,
      ...(options.status === undefined ? {} : { status: options.status }),
    });
  }

  /** Connects a real MCP SDK client (throws when the route refuses). */
  async function connect(options: { workspace?: string; agent?: string } = {}): Promise<Client> {
    const headers: Record<string, string> = { cookie: client.session };
    if (options.workspace !== undefined) headers['x-nexora-workspace'] = options.workspace;
    if (options.agent !== undefined) headers['x-nexora-agent'] = options.agent;
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers },
    });
    const mcp = new Client({ name: 'agent-mcp-test', version: '1.0.0' });
    openClients.push(mcp);
    await mcp.connect(transport);
    return mcp;
  }

  /** A raw MCP initialize POST (used to observe HTTP-level refusals). */
  async function rawInitialize(options: { workspace?: string; agent?: string }): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      cookie: client.session,
    };
    if (options.workspace !== undefined) headers['x-nexora-workspace'] = options.workspace;
    if (options.agent !== undefined) headers['x-nexora-agent'] = options.agent;
    return fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          clientInfo: { name: 'raw-agent-test', version: '1.0.0' },
        },
      }),
    });
  }

  async function auditEvents(): Promise<AuditEvent[]> {
    const response = await client.get(
      `/api/audit/events?organizationId=${organizationId}&workspaceId=${workspaceId}&limit=500`,
    );
    expect(response.statusCode).toBe(200);
    return (response.json() as { events: AuditEvent[] }).events;
  }

  async function blockedWith(reasonCode: string, marker: string): Promise<AuditEvent[]> {
    return (await auditEvents()).filter(
      (event) =>
        event.source === 'activity' &&
        event.status === 'blocked' &&
        (event.detail ?? '').includes(reasonCode) &&
        (event.detail ?? '').includes(marker),
    );
  }

  async function toolNames(mcp: Client): Promise<string[]> {
    return (await mcp.listTools()).tools.map((tool) => tool.name);
  }

  function structured(result: unknown): {
    code?: string;
    status?: string;
    approvalId?: string;
    event?: { title: string };
  } {
    return ((result as { structuredContent?: unknown }).structuredContent ?? {}) as {
      code?: string;
      status?: string;
      approvalId?: string;
      event?: { title: string };
    };
  }

  describe('(1) X-Nexora-Agent session binding', () => {
    it('a valid active agent of the workspace narrows tools/list to its effective delegations', async () => {
      const { agentId } = await provision();

      // Positive control: the HUMAN session of the same user sees tools the
      // agent is NOT delegated.
      const human = await connect({ workspace: workspaceId });
      const humanTools = await toolNames(human);
      expect(humanTools).toEqual(
        expect.arrayContaining([
          'nexora.projects.list',
          'nexora.notifications.list',
          'nexora.projects.create',
          'nexora.knowledge.search',
          'nexora.calendar.create_event',
        ]),
      );

      const agent = await connect({ workspace: workspaceId, agent: agentId });
      const agentTools = await toolNames(agent);
      expect(agentTools).toEqual(
        expect.arrayContaining([
          'nexora.projects.get',
          'nexora.knowledge.search',
          'nexora.calendar.create_event',
        ]),
      );
      // Held by the user, NOT delegated to the agent → not listed.
      expect(agentTools).not.toContain('nexora.projects.list');
      expect(agentTools).not.toContain('nexora.notifications.list');
      expect(agentTools).not.toContain('nexora.projects.create');
      expect(agentTools.length).toBeLessThan(humanTools.length);

      // Guessing an undelegated tool is not callable either.
      const guessed = await agent.callTool({ name: 'nexora.projects.list', arguments: {} });
      const guessedResult = structured(guessed);
      expect(guessedResult.code ?? guessedResult.status).toBe('TOOL_NOT_FOUND');
    });

    it('a fabricated agent id is refused with 403 and audited as AGENT_NOT_FOUND', async () => {
      const fabricated = 'agt_fabricated01';
      const refused = await rawInitialize({ workspace: workspaceId, agent: fabricated });
      expect(refused.status).toBe(403);
      const body = (await refused.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe('AUTHORIZATION_ERROR');

      const blocked = await blockedWith('AGENT_NOT_FOUND', `agent id: ${fabricated}`);
      expect(blocked).toHaveLength(1);
      expect(blocked[0]?.detail).toContain('action: mcp.agent_session');
      expect(blocked[0]?.detail).toContain('agent: mcp');
      expect(blocked[0]?.detail).toContain('outcome: blocked');

      // Positive control: a real agent id with the same headers is accepted.
      const { agentId } = await provision();
      const accepted = await rawInitialize({ workspace: workspaceId, agent: agentId });
      expect(accepted.status).toBe(200);
    });

    it('an agent of ANOTHER workspace is refused with 403 AGENT_OUT_OF_SCOPE', async () => {
      const { agentId } = await provision({ workspace: otherWorkspaceId });

      const refused = await rawInitialize({ workspace: workspaceId, agent: agentId });
      expect(refused.status).toBe(403);
      const blocked = await blockedWith('AGENT_OUT_OF_SCOPE', `agent id: ${agentId}`);
      expect(blocked).toHaveLength(1);
      expect(blocked[0]?.detail).toContain('action: mcp.agent_session');

      // Positive control: the same agent in its OWN workspace is accepted.
      const own = await connect({ workspace: otherWorkspaceId, agent: agentId });
      expect(await toolNames(own)).toContain('nexora.knowledge.search');
    });

    it('X-Nexora-Agent without X-Nexora-Workspace is refused with 403', async () => {
      const { agentId } = await provision();

      const refused = await rawInitialize({ agent: agentId });
      expect(refused.status).toBe(403);
      const body = (await refused.json()) as { error?: { code?: string; message?: string } };
      expect(body.error?.code).toBe('AUTHORIZATION_ERROR');
      expect(body.error?.message).toMatch(/X-Nexora-Workspace/);

      // Positive control: the same agent WITH the workspace header works.
      const accepted = await rawInitialize({ workspace: workspaceId, agent: agentId });
      expect(accepted.status).toBe(200);
    });

    it('a suspended agent is refused with 403 AGENT_SUSPENDED (reactivated → accepted)', async () => {
      const { agentId } = await provision({ status: 'suspended' });

      const refused = await rawInitialize({ workspace: workspaceId, agent: agentId });
      expect(refused.status).toBe(403);
      const blocked = await blockedWith('AGENT_SUSPENDED', `agent id: ${agentId}`);
      expect(blocked).toHaveLength(1);

      // Positive control: the same agent, reactivated, is accepted.
      const persisted = await client.repos.agents!.findById(organizationId, agentId);
      await client.repos.agents!.save({ ...persisted!, status: 'active' });
      const accepted = await rawInitialize({ workspace: workspaceId, agent: agentId });
      expect(accepted.status).toBe(200);
    });
  });

  describe('(2) execution-time delegation enforcement', () => {
    it('revoking a delegation mid-session fails the next call although the session context is cached', async () => {
      const { agentId, delegationIds } = await provision();
      const agent = await connect({ workspace: workspaceId, agent: agentId });

      // Positive control: the delegated read works.
      const allowed = await agent.callTool({
        name: 'nexora.knowledge.search',
        arguments: { question: 'onboarding' },
      });
      expect(allowed.isError ?? false).toBe(false);

      // Revoke the knowledge.search delegation directly in persistence.
      const knowledgeDelegationId = delegationIds[AGENT_DELEGATIONS.indexOf('knowledge.search')]!;
      const delegation = await client.repos.agentDelegations!.findById(
        organizationId,
        knowledgeDelegationId,
      );
      expect(delegation?.capabilityId).toBe('knowledge.search');
      await client.repos.agentDelegations!.save({ ...delegation!, status: 'revoked' });

      // The session was resolved ONCE — the tool is still advertised …
      expect(await toolNames(agent)).toContain('nexora.knowledge.search');
      // … but the executor re-checks the delegation at execution time.
      const denied = await agent.callTool({
        name: 'nexora.knowledge.search',
        arguments: { question: 'onboarding' },
      });
      expect(denied.isError).toBe(true);
      expect(structured(denied).code).toBe('EXECUTION_FAILED');

      const blocked = await blockedWith('DELEGATION_REVOKED', `agent id: ${agentId}`);
      expect(blocked).toHaveLength(1);
      expect(blocked[0]?.detail).toContain('tool: knowledge.search');
    });
  });

  describe('(3) FORGED_AGENT_CONTEXT in tool arguments', () => {
    it('agentId / delegationId in arguments are blocked and audited (clean arguments succeed)', async () => {
      const { agentId, delegationIds } = await provision();
      const agent = await connect({ workspace: workspaceId, agent: agentId });

      // Positive control: clean arguments succeed.
      const clean = await agent.callTool({
        name: 'nexora.knowledge.search',
        arguments: { question: 'policies' },
      });
      expect(clean.isError ?? false).toBe(false);

      const forgedAgent = await agent.callTool({
        name: 'nexora.knowledge.search',
        arguments: { question: 'policies', agentId: 'agt_someone_else' },
      });
      expect(forgedAgent.isError).toBe(true);
      expect(structured(forgedAgent).code).toBe('FORGED_AGENT_CONTEXT');

      const forgedDelegation = await agent.callTool({
        name: 'nexora.knowledge.search',
        arguments: { question: 'policies', delegationId: delegationIds[0] },
      });
      expect(forgedDelegation.isError).toBe(true);
      expect(structured(forgedDelegation).code).toBe('FORGED_AGENT_CONTEXT');

      const blocked = await blockedWith('FORGED_AGENT_CONTEXT', `agent id: ${agentId}`);
      expect(blocked).toHaveLength(2);
      for (const event of blocked) {
        expect(event.detail).toContain('tool: nexora.knowledge.search');
        expect(event.detail).toContain('agent: mcp');
        // Never argument values.
        expect(event.detail).not.toContain('agt_someone_else');
      }
    });

    it('a HUMAN session naming an agent in arguments is also FORGED_AGENT_CONTEXT', async () => {
      const human = await connect({ workspace: workspaceId });
      const before = (await blockedWith('FORGED_AGENT_CONTEXT', 'tool: nexora.projects.list'))
        .length;

      const clean = await human.callTool({ name: 'nexora.projects.list', arguments: {} });
      expect(clean.isError ?? false).toBe(false);

      const forged = await human.callTool({
        name: 'nexora.projects.list',
        arguments: { agentId: 'agt_impersonated' },
      });
      expect(forged.isError).toBe(true);
      expect(structured(forged).code).toBe('FORGED_AGENT_CONTEXT');
      expect((await blockedWith('FORGED_AGENT_CONTEXT', 'tool: nexora.projects.list')).length).toBe(
        before + 1,
      );
    });
  });

  describe('(4) governed write as an agent', () => {
    it('opens an approval recorded with the agentId that a human or another-workspace session cannot resume', async () => {
      const { agentId } = await provision();
      const events = client.repos.calendarEvents as FakeCalendarEntryRepository;
      const title = 'Agent Board Review';
      const args = {
        title,
        startsAt: '2026-10-16T10:00:00Z',
        endsAt: '2026-10-16T11:00:00Z',
      };
      const countByTitle = () =>
        [...events.entries.values()].filter((entry) => entry.title.value === title).length;

      // 1. The agent's write is gated → approval opened AS the agent.
      const agent = await connect({ workspace: workspaceId, agent: agentId });
      const first = structured(
        await agent.callTool({ name: 'nexora.calendar.create_event', arguments: args }),
      );
      expect(first.status).toBe('approval_required');
      const approvalId = first.approvalId!;
      expect(approvalId).toMatch(/^apr_/);
      expect(countByTitle()).toBe(0);

      // The approval is recorded with the agent principal (Audit Center).
      const approvalEvent = (await auditEvents()).find(
        (event) => event.source === 'approval' && event.id === `apr:${approvalId}`,
      );
      expect(approvalEvent?.agent?.id).toBe(agentId);

      // 2. Approve through the EXISTING decision route.
      const decision = await client.post(`/api/ai/approvals/${approvalId}/decision`, {
        decision: 'approve',
      });
      expect(decision.statusCode).toBe(200);

      // 3. A HUMAN session (same user, same workspace, same args) does NOT
      //    locate the agent's granted approval: it opens its own new gate.
      const human = await connect({ workspace: workspaceId });
      const humanResult = structured(
        await human.callTool({ name: 'nexora.calendar.create_event', arguments: args }),
      );
      expect(humanResult.status).toBe('approval_required');
      expect(humanResult.approvalId).toBeDefined();
      expect(humanResult.approvalId).not.toBe(approvalId);
      expect(countByTitle()).toBe(0);

      // 4. ANOTHER workspace (same user, same args) does NOT locate it either.
      const foreign = await connect({ workspace: otherWorkspaceId });
      const foreignResult = structured(
        await foreign.callTool({ name: 'nexora.calendar.create_event', arguments: args }),
      );
      expect(foreignResult.status).toBe('approval_required');
      expect(foreignResult.approvalId).toBeDefined();
      expect(foreignResult.approvalId).not.toBe(approvalId);
      expect(foreignResult.approvalId).not.toBe(humanResult.approvalId);
      expect(countByTitle()).toBe(0);

      // 5. Positive control: the agent session resumes ITS approval and the
      //    write executes exactly once.
      const resumed = structured(
        await agent.callTool({ name: 'nexora.calendar.create_event', arguments: args }),
      );
      expect(resumed.event?.title).toBe(title);
      expect(countByTitle()).toBe(1);

      // A fresh agent session for the same agent + workspace replays the
      // stored result (same resume key) — never a second event.
      const again = await connect({ workspace: workspaceId, agent: agentId });
      const replayed = await again.callTool({
        name: 'nexora.calendar.create_event',
        arguments: args,
      });
      expect(replayed.isError ?? false).toBe(false);
      expect(structured(replayed).status).not.toBe('approval_required');
      expect(structured(replayed).event?.title).toBe(title);
      expect(countByTitle()).toBe(1);
    });
  });
});
