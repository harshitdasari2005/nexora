/**
 * Audit Center tests: the unified read-only view over agent_executions,
 * approval_requests, workflow_step_executions, and activity_items.
 *
 * Security contract under test (P0-equivalent to every other RBAC'd
 * surface): organization + workspace membership are the scope boundary,
 * `audit.read` is the capability boundary. A role without the capability is
 * rejected with 403 even though it belongs to the tenant/workspace; a
 * forged organization/workspace resolves to 403; no data ever crosses a
 * tenant boundary.
 */

import { describe, expect, it } from 'vitest';
import type { AgentExecutionRecord } from '@nexora/contracts/agent';

import {
  chatClient,
  onboardOrgAndWorkspace,
  buildTestApp,
  login,
  type ChatClient,
} from './helpers.js';
import { FakeAgentExecutionRecorder } from './fakes.js';

/** A minimal, realistic agent-execution record. */
function agentExecutionRecord(overrides: Partial<AgentExecutionRecord> = {}): AgentExecutionRecord {
  return {
    id: 'agx_11111111-1111-4111-8111-111111111111',
    agentId: 'agent_ceo',
    roleId: 'executive.ceo',
    domainId: 'executive',
    tenantId: 'org_placeholder',
    userId: 'usr_placeholder',
    status: 'completed',
    proposalAction: 'Review quarterly project health',
    createdAt: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

/** A logged-in client wired with a custom agent-execution recorder. */
async function chatClientWithRecorder(recorder: FakeAgentExecutionRecorder): Promise<ChatClient> {
  const { app, repos, store } = await buildTestApp({ agentExecutionRecorder: recorder });
  const session = await login(app);
  return {
    app,
    session,
    store,
    repos,
    get(path) {
      return app.inject({ method: 'GET', url: path, headers: { cookie: session } });
    },
    post(path, body) {
      return app.inject({
        method: 'POST',
        url: path,
        headers: { cookie: session, 'content-type': 'application/json' },
        payload: body,
      });
    },
    put(path, body) {
      return app.inject({
        method: 'PUT',
        url: path,
        headers: { cookie: session, 'content-type': 'application/json' },
        payload: body,
      });
    },
    patch(path, body) {
      return app.inject({
        method: 'PATCH',
        url: path,
        headers: { cookie: session, 'content-type': 'application/json' },
        payload: body,
      });
    },
    postEmpty(path) {
      return app.inject({
        method: 'POST',
        url: path,
        headers: { cookie: session, 'content-type': 'application/json' },
        payload: {},
      });
    },
  };
}

describe('Audit Center — authorization', () => {
  it('a CEO (holds audit.read) can list events', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const response = await client.get(
      `/api/audit/events?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    expect(Array.isArray((response.json() as { events: unknown[] }).events)).toBe(true);
  });

  it("the Legal persona (general_counsel, owner tier) can list events — the module's explicit requirement", async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'legal',
    });

    const response = await client.get(
      `/api/audit/events?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
  });

  it('a CFO (no audit.read) is rejected with 403', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'finance',
    });

    const response = await client.get(
      `/api/audit/events?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
  });

  it('a forged role/capability claim in the query never grants the missing capability', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'finance',
    });

    const forged = await client.app.inject({
      method: 'GET',
      url: `/api/audit/events?organizationId=${organizationId}&workspaceId=${workspaceId}&role=executive.ceo&capability=audit.read`,
      headers: { cookie: client.session },
    });
    expect(forged.statusCode).toBe(403);
  });

  it('a real CEO of one tenant cannot read the audit trail of a foreign tenant', async () => {
    const client = await chatClient();
    const { workspaceId } = await onboardOrgAndWorkspace(client);

    const foreign = await client.get(
      `/api/audit/events?organizationId=org_alien_0000&workspaceId=${workspaceId}`,
    );
    expect(foreign.statusCode).toBe(403);
  });

  it('a forged (non-member) workspace is rejected with 403 even for a real CEO of the organization', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const forged = await client.get(
      `/api/audit/events?organizationId=${organizationId}&workspaceId=wsp_alien_0000`,
    );
    expect(forged.statusCode).toBe(403);
  });

  it('rejects unauthenticated access with 401', async () => {
    const client = await chatClient();
    const response = await client.app.inject({
      method: 'GET',
      url: '/api/audit/events?organizationId=org_x&workspaceId=wsp_x',
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('Audit Center — unified event content', () => {
  it('surfaces a real activity_items event (project creation) with a human-readable actor and action', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const created = await client.post('/api/projects', {
      organizationId,
      name: 'Mobile Banking',
    });
    expect(created.statusCode).toBe(201);

    const response = await client.get(
      `/api/audit/events?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const events = (
      response.json() as {
        events: { source: string; action: string; actorName: string; status: string }[];
      }
    ).events;
    const projectEvent = events.find((event) => event.source === 'activity');
    expect(projectEvent).toBeDefined();
    expect(projectEvent?.action).toBe('Project created');
    // The actor is a resolved human name — never a raw user id.
    expect(projectEvent?.actorName).not.toMatch(/^usr_/);
    expect(projectEvent?.actorName.length).toBeGreaterThan(0);
  });

  it('surfaces an agent_execution event with resolved role, module, and action', async () => {
    const recorder = new FakeAgentExecutionRecorder();
    const client = await chatClientWithRecorder(recorder);
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    // Seed one realistic agent-execution row for THIS org/workspace/user.
    const me = await client.get('/api/me');
    const meBody = me.json() as { user: { id: string } };
    await recorder.record(
      agentExecutionRecord({
        tenantId: organizationId,
        workspaceId,
        userId: meBody.user.id,
      }),
    );

    const response = await client.get(
      `/api/audit/events?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const events = (
      response.json() as {
        events: {
          source: string;
          action: string;
          roleName?: string;
          module: string;
          statusLabel: string;
          actorName: string;
        }[];
      }
    ).events;
    const agentEvent = events.find((event) => event.source === 'agent_execution');
    expect(agentEvent).toBeDefined();
    expect(agentEvent?.action).toBe('Review quarterly project health');
    expect(agentEvent?.roleName).toBe('CEO');
    expect(agentEvent?.module).toBe('Executive');
    expect(agentEvent?.statusLabel).toBe('Completed');
    expect(agentEvent?.actorName.length).toBeGreaterThan(0);
  });

  it('never leaks an agent-execution row from a foreign tenant', async () => {
    const recorder = new FakeAgentExecutionRecorder();
    const client = await chatClientWithRecorder(recorder);
    const { workspaceId } = await onboardOrgAndWorkspace(client);

    await recorder.record(
      agentExecutionRecord({
        id: 'agx_alien',
        tenantId: 'org_alien_0000',
        userId: 'usr_alien',
      }),
    );

    // The caller's OWN org — the alien row must never appear here.
    const meOrg = await client.get('/api/me');
    const org = (meOrg.json() as { organizations: { id: string }[] }).organizations[0]?.id;
    const response = await client.get(
      `/api/audit/events?organizationId=${org}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const events = (response.json() as { events: { id: string }[] }).events;
    expect(events.some((event) => event.id === 'agx:agx_alien')).toBe(false);
  });

  it('filters by source', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    await client.post('/api/projects', { organizationId, name: 'Filter Test' });

    const response = await client.get(
      `/api/audit/events?organizationId=${organizationId}&workspaceId=${workspaceId}&source=activity`,
    );
    expect(response.statusCode).toBe(200);
    const events = (response.json() as { events: { source: string }[] }).events;
    expect(events.every((event) => event.source === 'activity')).toBe(true);
  });
});
