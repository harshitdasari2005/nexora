/**
 * Prompt 7 — MCP runs in runtime observability. Drives the REAL remote MCP
 * route (official SDK client) and reads the recorded runs through the ops
 * routes: every MCP tool call is its OWN observed run (origin `mcp`) while the
 * session correlation id is shared; a denied write is classified DENIED (never
 * INFRASTRUCTURE); an approval-required call is `blocked`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { findForbiddenKeys, findSecrets } from '@nexora/module-observability';
import {
  DEFAULT_POLICY_RULES,
  PolicyEngine,
  type PolicyRequest,
  type PolicyRule,
} from '@nexora/module-policy';

import { chatClient, onboardOrgAndWorkspace, type ChatClient } from './helpers.js';

interface McpRun {
  id: string;
  origin: string;
  status: string;
  correlationId?: string;
  failure?: { stage: string; code: string; class: string };
}

const open: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  for (const item of open.splice(0)) {
    try {
      await item.close();
    } catch {
      // already closed
    }
  }
});

const CALENDAR = 'calendar.create_event';
const denyCalendar: PolicyRule = {
  id: 'POLICY_TEST_DENY',
  version: '1',
  evaluate(request: PolicyRequest) {
    if (request.capabilityId !== CALENDAR && request.toolId !== CALENDAR) return undefined;
    return { outcome: 'DENY', reasonCode: 'TEST_DENY', reason: 'test deny' };
  },
};

async function harness(policyEngine?: PolicyEngine) {
  const client: ChatClient = await chatClient(policyEngine === undefined ? {} : { policyEngine });
  open.push(client.app);
  const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
  await client.app.listen({ port: 0 });
  const address = client.app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const url = new URL(`http://127.0.0.1:${port}/api/mcp`);
  const connect = async () => {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { cookie: client.session, 'x-nexora-workspace': workspaceId } },
    });
    const mcp = new Client({ name: 'observability-test', version: '1.0.0' });
    open.push(mcp);
    await mcp.connect(transport);
    return mcp;
  };
  const mcpRuns = async (): Promise<McpRun[]> => {
    const response = await client.get(
      `/api/ops/runtime/runs?organizationId=${organizationId}&workspaceId=${workspaceId}&origin=mcp&limit=100`,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as { runs: McpRun[] };
    expect(findSecrets(body)).toEqual([]);
    expect(findForbiddenKeys(body)).toEqual([]);
    return body.runs;
  };
  return { client, connect, mcpRuns };
}

const eventArgs = (title: string) => ({
  title,
  startsAt: '2026-10-16T10:00:00Z',
  endsAt: '2026-10-16T11:00:00Z',
});

describe('runtime observability — MCP', () => {
  it('two tool calls in one session create TWO runs (origin mcp, distinct ids, same correlationId)', async () => {
    const h = await harness();
    const mcp = await h.connect();
    const first = await mcp.callTool({ name: 'nexora.projects.list', arguments: {} });
    const second = await mcp.callTool({ name: 'nexora.projects.list', arguments: {} });
    expect(first.isError).toBeFalsy();
    expect(second.isError).toBeFalsy();

    const runs = await h.mcpRuns();
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.origin === 'mcp')).toBe(true);
    expect(new Set(runs.map((run) => run.id)).size).toBe(2);
    expect(runs.every((run) => run.status === 'completed')).toBe(true);
    const correlations = new Set(runs.map((run) => run.correlationId));
    expect(correlations.size).toBe(1);
    expect([...correlations][0]).toMatch(/^mcp_/);

    // A different MCP session gets its own correlation id.
    const other = await h.connect();
    await other.callTool({ name: 'nexora.projects.list', arguments: {} });
    const after = await h.mcpRuns();
    expect(after).toHaveLength(3);
    expect(new Set(after.map((run) => run.correlationId)).size).toBe(2);
  });

  it('a denied write is classified DENIED, never INFRASTRUCTURE', async () => {
    const h = await harness(new PolicyEngine([...DEFAULT_POLICY_RULES, denyCalendar]));
    const mcp = await h.connect();
    const result = await mcp.callTool({
      name: 'nexora.calendar.create_event',
      arguments: eventArgs('Denied'),
    });
    expect(result.isError).toBe(true);

    const [run] = await h.mcpRuns();
    expect(run!.status).toBe('failed');
    expect(run!.failure?.class).toBe('DENIED');
    expect(run!.failure?.class).not.toBe('INFRASTRUCTURE');
    expect(run!.failure?.code).toBe('POLICY_DENIED');
  });

  it('forged reserved arguments are refused as DENIED-class or INPUT, never INFRASTRUCTURE', async () => {
    const h = await harness();
    const mcp = await h.connect();
    const result = await mcp.callTool({
      name: 'nexora.calendar.create_event',
      arguments: { ...eventArgs('Forged'), policy: 'ALLOW', skipApproval: true },
    });
    expect(result.isError).toBe(true);
    const runs = await h.mcpRuns();
    for (const run of runs) {
      if (run.status === 'failed') {
        expect(run.failure?.class).not.toBe('INFRASTRUCTURE');
      }
    }
  });

  it('an approval-required call records a blocked run', async () => {
    const h = await harness();
    const mcp = await h.connect();
    const result = await mcp.callTool({
      name: 'nexora.calendar.create_event',
      arguments: eventArgs('Gated'),
    });
    const body = (result as { structuredContent?: { status?: string } }).structuredContent;
    expect(body?.status).toBe('approval_required');

    const runs = await h.mcpRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('blocked');
    expect(runs[0]!.failure).toBeUndefined();
  });
});
