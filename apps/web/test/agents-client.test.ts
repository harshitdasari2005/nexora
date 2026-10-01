/**
 * Agent identity client tests: the organization + workspace scope travels in
 * the querystring only, and request bodies never carry identity fields.
 * Stubbed global fetch — no DOM or real network required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAgent,
  grantDelegation,
  inspectAgent,
  listAgents,
  revokeDelegation,
  setAgentStatus,
} from '../src/lib/agents.js';
import { executeAgentIntent, executeProposal } from '../src/lib/agent.js';

const scope = { organizationId: 'org_1', workspaceId: 'wsp_1' };
const SCOPE_QS = 'organizationId=org_1&workspaceId=wsp_1';
const FORBIDDEN = ['userId', 'ownerUserId', 'organizationId', 'workspaceId', 'tenantId'];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => json({ agents: [], agent: {}, delegation: {}, changed: true }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(): { url: string; method: string | undefined; body: unknown } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url,
    method: init.method,
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
  };
}

function expectNoIdentity(body: unknown): void {
  for (const key of FORBIDDEN) {
    expect(Object.keys((body ?? {}) as object)).not.toContain(key);
  }
}

describe('agent identity client', () => {
  it('reads the REAL list shape (one authority view per agent), returning the agent records', async () => {
    // Captured from the live API: GET /api/agents → { agents: [{ agent, delegations, … }] }.
    fetchMock.mockResolvedValueOnce(
      json({
        agents: [
          {
            agent: {
              id: 'agt_1',
              name: 'Finance Assistant',
              status: 'active',
              definitionId: 'finance',
            },
            delegations: [],
            effectiveCapabilityIds: [],
            definitionCapabilityIds: ['finance.submit_expense'],
          },
        ],
      }),
    );
    const agents = await listAgents(scope);
    expect(agents.map((a) => [a.id, a.status])).toEqual([['agt_1', 'active']]);
  });

  it('lists and inspects with the scope in the querystring', async () => {
    await listAgents(scope);
    expect(lastCall()).toMatchObject({ url: `/api/agents?${SCOPE_QS}` });
    fetchMock.mockResolvedValueOnce(json({ agent: {}, delegations: [] }));
    await inspectAgent(scope, 'agt_1');
    expect(lastCall().url).toBe(`/api/agents/agt_1?${SCOPE_QS}`);
  });

  it('creates an agent with only its own fields', async () => {
    await createAgent(scope, { definitionId: 'finance', name: 'Fin', description: '' });
    const call = lastCall();
    expect(call.url).toBe(`/api/agents?${SCOPE_QS}`);
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ definitionId: 'finance', name: 'Fin' });
    expectNoIdentity(call.body);
  });

  it('posts status changes without identity fields', async () => {
    for (const action of ['suspend', 'reactivate', 'revoke'] as const) {
      await setAgentStatus(scope, 'agt_1', action, 'why');
      const call = lastCall();
      expect(call.url).toBe(`/api/agents/agt_1/${action}?${SCOPE_QS}`);
      expect(call.body).toEqual({ reason: 'why' });
      expectNoIdentity(call.body);
    }
  });

  it('grants and revokes delegations without identity fields', async () => {
    await grantDelegation(scope, 'agt_1', {
      capabilityId: 'projects.assign_employee',
      resourceScope: { kind: 'project', id: 'prj_1' },
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    let call = lastCall();
    expect(call.url).toBe(`/api/agents/agt_1/delegations?${SCOPE_QS}`);
    expect(call.body).toEqual({
      capabilityId: 'projects.assign_employee',
      resourceScope: { kind: 'project', id: 'prj_1' },
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    expectNoIdentity(call.body);

    await revokeDelegation(scope, 'agt_1', 'dlg_1');
    call = lastCall();
    expect(call.url).toBe(`/api/agents/agt_1/delegations/dlg_1/revoke?${SCOPE_QS}`);
    expect(call.body).toEqual({});
  });

  it('legacy execute routes pass the selected agentId in the querystring', async () => {
    await executeAgentIntent(scope, 'do it', 'agt_1');
    let call = lastCall();
    expect(call.url).toBe(`/api/agent/execute?${SCOPE_QS}&agentId=agt_1`);
    expect(call.body).toEqual({ utterance: 'do it' });
    await executeProposal(scope, 'prop_1', 'agt_1');
    call = lastCall();
    expect(call.url).toBe(`/api/agent/proposals/prop_1/execute?${SCOPE_QS}&agentId=agt_1`);
  });
});
