/**
 * Prompt 4 — execution AS a persisted agent principal (`fastify.inject`).
 *
 * Exercises the REAL authorization path end to end: the agent identity
 * routes (`POST /api/agents/:agentId/execute` and
 * `/proposals/:proposalId/execute`) → the business-agent engine → the
 * orchestrator's pre-approval delegation check → the ToolExecutor's
 * execution-time delegation check → the approval decision route resuming AS
 * the agent → the Audit Center. Time is controlled through the injected
 * `agentClock`, so expiry is evaluated deterministically at execution time.
 *
 * Every denial is paired with a positive control (the same setup with the
 * right delegation succeeds), so no test can pass vacuously.
 */

import { describe, expect, it } from 'vitest';
import type { AgentExecutionOutcome, AgentResourceScope } from '@nexora/contracts/agent';

import { FakeAgentExecutionRecorder } from './fakes.js';
import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  parseSse,
  provisionAgent,
  seedOrganization,
  seedProject,
  seedWorkspace,
  seedWorkspaceMembership,
  type ChatClient,
} from './helpers.js';

/** The injected authority clock's starting instant. */
const T0 = new Date('2026-09-29T12:00:00.000Z');

interface Harness {
  client: ChatClient;
  recorder: FakeAgentExecutionRecorder;
  organizationId: string;
  workspaceId: string;
  scope: string;
  /** Moves the injected agent-authority clock. */
  setNow(at: Date): void;
}

interface ExecuteBody {
  outcome: AgentExecutionOutcome;
  principal: { id: string; name: string; definitionId: string; status: string };
}

interface AuditEvent {
  id: string;
  source: string;
  status: string;
  detail?: string;
  agent?: { id: string; name?: string; definitionId?: string };
  delegationIds?: readonly string[];
  references?: Record<string, string>;
}

async function harness(): Promise<Harness> {
  let now = T0;
  const recorder = new FakeAgentExecutionRecorder();
  const client = await chatClient({
    agentClock: () => now,
    agentExecutionRecorder: recorder,
  });
  const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
  return {
    client,
    recorder,
    organizationId,
    workspaceId,
    scope: `organizationId=${organizationId}&workspaceId=${workspaceId}`,
    setNow: (at) => {
      now = at;
    },
  };
}

async function agentWith(
  h: Harness,
  capabilityIds: readonly string[],
  options: {
    resourceScope?: AgentResourceScope;
    expiresAt?: string;
    status?: 'active' | 'suspended' | 'revoked';
    name?: string;
  } = {},
): Promise<{ agentId: string; delegationIds: string[] }> {
  return provisionAgent(h.client.repos, {
    organizationId: h.organizationId,
    workspaceId: h.workspaceId,
    definitionId: 'executive',
    grantedBy: currentUserId(h.client),
    capabilityIds,
    name: options.name ?? 'Chief of Staff',
    ...(options.resourceScope === undefined ? {} : { resourceScope: options.resourceScope }),
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
    ...(options.status === undefined ? {} : { status: options.status }),
  });
}

async function execute(h: Harness, agentId: string, utterance: string) {
  return h.client.post(`/api/agents/${agentId}/execute?${h.scope}`, { utterance });
}

async function executeOk(h: Harness, agentId: string, utterance: string): Promise<ExecuteBody> {
  const response = await execute(h, agentId, utterance);
  expect(response.statusCode).toBe(200);
  return response.json() as ExecuteBody;
}

async function auditEvents(h: Harness, filters = ''): Promise<AuditEvent[]> {
  const response = await h.client.get(`/api/audit/events?${h.scope}${filters}`);
  expect(response.statusCode).toBe(200);
  return (response.json() as { events: AuditEvent[] }).events;
}

async function blockedFor(h: Harness, agentId: string): Promise<AuditEvent[]> {
  return (await auditEvents(h, `&source=activity&status=blocked&agentId=${agentId}`)).filter(
    (event) => event.source === 'activity' && event.status === 'blocked',
  );
}

async function calendarTitles(h: Harness): Promise<string[]> {
  const response = await h.client.get(`/api/calendar/events?${h.scope}`);
  expect(response.statusCode).toBe(200);
  return (response.json() as { events: { title: string }[] }).events.map((event) => event.title);
}

async function decide(h: Harness, approvalId: string, decision: 'approve' | 'reject' = 'approve') {
  const response = await h.client.post(`/api/ai/approvals/${approvalId}/decision`, { decision });
  expect(response.statusCode).toBe(200);
  const events = parseSse(response.body);
  const done = events.find((event) => event.event === 'done')?.data as
    { status?: string; steps?: { status: string; toolId: string; error?: string }[] } | undefined;
  return { response, done };
}

const ATTENTION = 'What needs my attention?';
const WRITE_INTENT = 'Create a calendar event titled Board Prep tomorrow at 9am';

describe('agent execution without / with a delegation', () => {
  it('no delegation → step failed, no tool execution, audited DELEGATION_MISSING', async () => {
    const h = await harness();
    const { agentId } = await agentWith(h, []);

    const body = await executeOk(h, agentId, ATTENTION);
    expect(body.principal.id).toBe(agentId);
    expect(body.outcome.status).not.toBe('completed');
    expect(body.outcome.steps).toHaveLength(1);
    const step = body.outcome.steps[0];
    expect(step?.capabilityId).toBe('notifications.what_needs_attention');
    expect(step?.status).toBe('failed');
    expect(step?.verified).toBe(false);
    expect(step?.output).toBeUndefined();
    expect(step?.delegationId).toBeUndefined();

    const blocked = await blockedFor(h, agentId);
    const denial = blocked.find((event) => event.detail?.includes('DELEGATION_MISSING'));
    expect(denial).toBeDefined();
    expect(denial?.agent?.id).toBe(agentId);
    expect(denial?.detail).toContain(`agent id: ${agentId}`);
  });

  it('positive control: with the delegation the run completes as the agent and is journaled', async () => {
    const h = await harness();
    const { agentId, delegationIds } = await agentWith(h, ['notifications.what_needs_attention']);

    const body = await executeOk(h, agentId, ATTENTION);
    expect(body.outcome.status).toBe('completed');
    const step = body.outcome.steps[0];
    expect(step?.status).toBe('succeeded');
    expect(step?.verified).toBe(true);
    expect(step?.delegationId).toBe(delegationIds[0]);

    expect(await blockedFor(h, agentId)).toEqual([]);
    const runs = (await auditEvents(h, `&source=agent_execution&agentId=${agentId}`)).filter(
      (event) => event.source === 'agent_execution',
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('completed');
    expect(runs[0]?.agent).toMatchObject({ id: agentId, name: 'Chief of Staff' });
    expect(runs[0]?.delegationIds).toEqual([delegationIds[0]]);
  });

  it('the proposal route runs AS the agent too (delegation required)', async () => {
    const h = await harness();
    await h.client.post('/api/projects', {
      organizationId: h.organizationId,
      name: 'Mobile Banking',
    });
    const denied = await agentWith(h, ['notifications.what_needs_attention'], { name: 'Reader' });
    const allowed = await agentWith(h, ['projects.find_project'], { name: 'Finder' });

    const refused = await h.client.post(
      `/api/agents/${denied.agentId}/proposals/propose_review_projects/execute?${h.scope}`,
      {},
    );
    expect(refused.statusCode).toBe(200);
    const refusedBody = refused.json() as ExecuteBody;
    expect(refusedBody.outcome.steps[0]?.status).toBe('failed');
    expect(
      (await blockedFor(h, denied.agentId)).some((event) =>
        event.detail?.includes('CAPABILITY_OUTSIDE_DELEGATION'),
      ),
    ).toBe(true);

    const ran = await h.client.post(
      `/api/agents/${allowed.agentId}/proposals/propose_review_projects/execute?${h.scope}`,
      {},
    );
    expect(ran.statusCode).toBe(200);
    const ranBody = ran.json() as ExecuteBody;
    expect(ranBody.principal.id).toBe(allowed.agentId);
    expect(ranBody.outcome.status).toBe('completed');
    expect(ranBody.outcome.steps[0]?.delegationId).toBe(allowed.delegationIds[0]);
  });
});

describe('delegation bounds enforced at execution', () => {
  it('a read-only delegation cannot drive a write: CAPABILITY_OUTSIDE_DELEGATION, no approval, no event', async () => {
    const h = await harness();
    const { agentId } = await agentWith(h, ['notifications.what_needs_attention']);

    const body = await executeOk(h, agentId, WRITE_INTENT);
    expect(body.outcome.status).not.toBe('completed');
    expect(body.outcome.approvals).toEqual([]);
    const step = body.outcome.steps[0];
    expect(step?.capabilityId).toBe('calendar.create_event');
    expect(step?.status).toBe('failed');

    const blocked = await blockedFor(h, agentId);
    expect(blocked.some((event) => event.detail?.includes('CAPABILITY_OUTSIDE_DELEGATION'))).toBe(
      true,
    );
    expect(await auditEvents(h, '&source=approval')).toEqual([]);
    expect(await calendarTitles(h)).not.toContain('Board Prep');

    // Positive control: the write delegation reaches the approval gate.
    const writer = await agentWith(h, ['calendar.create_event'], { name: 'Writer' });
    const gated = await executeOk(h, writer.agentId, WRITE_INTENT);
    expect(gated.outcome.status).toBe('blocked');
    expect(gated.outcome.approvals[0]?.status).toBe('pending');
  });

  it('a project-scoped delegation reaches its project only', async () => {
    const h = await harness();
    await seedProject(h.client.repos, {
      id: 'P123',
      organizationId: h.organizationId,
      name: 'Alpha Ledger',
    });
    await seedProject(h.client.repos, {
      id: 'P456',
      organizationId: h.organizationId,
      name: 'Beta Vault',
    });
    const { agentId, delegationIds } = await agentWith(h, ['projects.find_project'], {
      resourceScope: { kind: 'project', id: 'P123' },
    });

    const inScope = await executeOk(h, agentId, 'Find the Alpha Ledger project');
    expect(inScope.outcome.status).toBe('completed');
    expect(inScope.outcome.steps[0]?.status).toBe('succeeded');
    expect(inScope.outcome.steps[0]?.delegationId).toBe(delegationIds[0]);
    expect(JSON.stringify(inScope.outcome.steps[0]?.output)).toContain('Alpha Ledger');

    const outOfScope = await executeOk(h, agentId, 'Find the Beta Vault project');
    expect(outOfScope.outcome.status).not.toBe('completed');
    expect(outOfScope.outcome.steps[0]?.status).toBe('failed');
    // No project data reached the agent: the tool never ran.
    expect(outOfScope.outcome.steps[0]?.output).toBeUndefined();
    expect(outOfScope.outcome.steps[0]?.delegationId).toBeUndefined();
    const blocked = await blockedFor(h, agentId);
    expect(
      blocked.some((event) => event.detail?.includes('DELEGATION_RESOURCE_OUT_OF_SCOPE')),
    ).toBe(true);
  });

  it('an expired delegation is refused (DELEGATION_EXPIRED) against the injected clock', async () => {
    const h = await harness();
    const expired = await agentWith(h, ['notifications.what_needs_attention'], {
      expiresAt: new Date(T0.getTime() - 60_000).toISOString(),
      name: 'Expired',
    });
    const body = await executeOk(h, expired.agentId, ATTENTION);
    expect(body.outcome.steps[0]?.status).toBe('failed');
    expect(
      (await blockedFor(h, expired.agentId)).some((event) =>
        event.detail?.includes('DELEGATION_EXPIRED'),
      ),
    ).toBe(true);

    // Positive control: expiry in the future of the injected clock succeeds.
    const live = await agentWith(h, ['notifications.what_needs_attention'], {
      expiresAt: new Date(T0.getTime() + 60_000).toISOString(),
      name: 'Live',
    });
    const ok = await executeOk(h, live.agentId, ATTENTION);
    expect(ok.outcome.status).toBe('completed');
    expect(ok.outcome.steps[0]?.delegationId).toBe(live.delegationIds[0]);
  });

  it('a revoked delegation is refused (DELEGATION_REVOKED)', async () => {
    const h = await harness();
    const { agentId, delegationIds } = await agentWith(h, ['notifications.what_needs_attention']);

    // Positive control first: the delegation works.
    expect((await executeOk(h, agentId, ATTENTION)).outcome.status).toBe('completed');

    const revoked = await h.client.post(
      `/api/agents/${agentId}/delegations/${delegationIds[0] ?? ''}/revoke?${h.scope}`,
      {},
    );
    expect(revoked.statusCode).toBe(200);

    const body = await executeOk(h, agentId, ATTENTION);
    expect(body.outcome.status).not.toBe('completed');
    expect(body.outcome.steps[0]?.status).toBe('failed');
    expect(
      (await blockedFor(h, agentId)).some((event) => event.detail?.includes('DELEGATION_REVOKED')),
    ).toBe(true);
  });
});

describe('agent status and scope', () => {
  it('a suspended agent is refused with 403 agent-suspended and audited AGENT_SUSPENDED', async () => {
    const h = await harness();
    const { agentId } = await agentWith(h, ['notifications.what_needs_attention']);
    expect((await executeOk(h, agentId, ATTENTION)).outcome.status).toBe('completed');

    const suspended = await h.client.post(`/api/agents/${agentId}/suspend?${h.scope}`, {});
    expect(suspended.statusCode).toBe(200);

    const response = await execute(h, agentId, ATTENTION);
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { reason: string } }).error.reason).toBe('agent-suspended');
    expect(
      (await blockedFor(h, agentId)).some((event) => event.detail?.includes('AGENT_SUSPENDED')),
    ).toBe(true);

    // Reactivated → runs again (positive control on the same identity).
    const reactivated = await h.client.post(`/api/agents/${agentId}/reactivate?${h.scope}`, {});
    expect(reactivated.statusCode).toBe(200);
    expect((await executeOk(h, agentId, ATTENTION)).outcome.status).toBe('completed');
  });

  it('a revoked agent is refused with 403 agent-revoked and audited AGENT_REVOKED', async () => {
    const h = await harness();
    const { agentId } = await agentWith(h, ['notifications.what_needs_attention']);
    expect((await executeOk(h, agentId, ATTENTION)).outcome.status).toBe('completed');

    const revoked = await h.client.post(`/api/agents/${agentId}/revoke?${h.scope}`, {});
    expect(revoked.statusCode).toBe(200);

    const response = await execute(h, agentId, ATTENTION);
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { reason: string } }).error.reason).toBe('agent-revoked');
    expect(
      (await blockedFor(h, agentId)).some((event) => event.detail?.includes('AGENT_REVOKED')),
    ).toBe(true);
  });

  it('cross-workspace: an agent of workspace A executed in workspace B is 403 agent-out-of-scope', async () => {
    const h = await harness();
    const { agentId } = await agentWith(h, ['notifications.what_needs_attention']);
    const otherWorkspaceId = 'wsp_exec_other';
    await seedWorkspace(h.client.repos, {
      id: otherWorkspaceId,
      organizationId: h.organizationId,
      slug: 'exec-other',
    });
    await seedWorkspaceMembership(h.client.repos, {
      workspaceId: otherWorkspaceId,
      userId: currentUserId(h.client),
      role: 'owner',
      organizationId: h.organizationId,
    });

    const response = await h.client.post(
      `/api/agents/${agentId}/execute?organizationId=${h.organizationId}&workspaceId=${otherWorkspaceId}`,
      { utterance: ATTENTION },
    );
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { reason: string } }).error.reason).toBe(
      'agent-out-of-scope',
    );

    // Positive control: the agent's own workspace runs.
    expect((await executeOk(h, agentId, ATTENTION)).outcome.status).toBe('completed');
  });

  it('cross-tenant: another organization’s agent id resolves to 404', async () => {
    const h = await harness();
    await seedOrganization(h.client.repos, { id: 'org_foreign', slug: 'foreign' });
    await seedWorkspace(h.client.repos, {
      id: 'wsp_foreign',
      organizationId: 'org_foreign',
      slug: 'foreign-eng',
    });
    const foreign = await provisionAgent(h.client.repos, {
      organizationId: 'org_foreign',
      workspaceId: 'wsp_foreign',
      definitionId: 'executive',
      grantedBy: 'usr_foreign',
      capabilityIds: ['notifications.what_needs_attention'],
    });

    const response = await execute(h, foreign.agentId, ATTENTION);
    expect(response.statusCode).toBe(404);
    expect((response.json() as { error: { reason: string } }).error.reason).toBe('agent-not-found');

    // Positive control: an own-tenant agent runs.
    const own = await agentWith(h, ['notifications.what_needs_attention']);
    expect((await executeOk(h, own.agentId, ATTENTION)).outcome.status).toBe('completed');
  });
});

describe('approvals opened by an agent resume AS the agent', () => {
  async function openApproval(h: Harness, options: { expiresAt?: string } = {}) {
    const agent = await agentWith(h, ['calendar.create_event'], options);
    const body = await executeOk(h, agent.agentId, WRITE_INTENT);
    expect(body.outcome.status).toBe('blocked');
    const pending = body.outcome.approvals[0];
    expect(pending?.status).toBe('pending');
    expect(pending?.toolId).toBe('calendar.create_event');
    expect(await calendarTitles(h)).not.toContain('Board Prep');
    return { ...agent, approvalId: pending?.id ?? '' };
  }

  it('approve → completes exactly once, journaled with agentIdentityId + approvalId', async () => {
    const h = await harness();
    const { agentId, delegationIds, approvalId } = await openApproval(h);

    // The approval record is bound to the agent (Audit Center approval row).
    const approvalRow = (await auditEvents(h, '&source=approval')).find(
      (event) => event.id === `apr:${approvalId}`,
    );
    expect(approvalRow?.agent?.id).toBe(agentId);
    expect(approvalRow?.delegationIds).toEqual([delegationIds[0]]);

    const { done } = await decide(h, approvalId);
    expect(done?.status).toBe('completed');
    expect((await calendarTitles(h)).filter((title) => title === 'Board Prep')).toHaveLength(1);

    const resumed = h.recorder.records.filter((record) => record.approvalId === approvalId);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({
      agentIdentityId: agentId,
      approvalId,
      status: 'completed',
      delegationIds: [delegationIds[0]],
    });
  });

  it('revoking the delegation after the approval opened blocks the resumed run (DELEGATION_REVOKED)', async () => {
    const h = await harness();
    const { agentId, delegationIds, approvalId } = await openApproval(h);

    const revoked = await h.client.post(
      `/api/agents/${agentId}/delegations/${delegationIds[0] ?? ''}/revoke?${h.scope}`,
      {},
    );
    expect(revoked.statusCode).toBe(200);

    const { done } = await decide(h, approvalId);
    expect(done?.status).not.toBe('completed');
    expect(done?.steps?.[0]?.status).toBe('failed');
    expect(await calendarTitles(h)).not.toContain('Board Prep');
    expect(
      (await blockedFor(h, agentId)).some((event) => event.detail?.includes('DELEGATION_REVOKED')),
    ).toBe(true);
    // The resumed run was still attributed to the agent, and journaled as not completed.
    const resumed = h.recorder.records.filter((record) => record.approvalId === approvalId);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.agentIdentityId).toBe(agentId);
    expect(resumed[0]?.status).not.toBe('completed');
  });

  it('the delegation expiring between approval and decision blocks the resumed run (DELEGATION_EXPIRED)', async () => {
    const h = await harness();
    const expiresAt = new Date(T0.getTime() + 60 * 60_000).toISOString();
    const control = await openApproval(h, { expiresAt });
    const { agentId, approvalId } = await openApproval(h, { expiresAt });

    // Positive control: the same expiring delegation decided BEFORE expiry completes.
    const { done: controlDone } = await decide(h, control.approvalId);
    expect(controlDone?.status).toBe('completed');
    expect((await calendarTitles(h)).filter((title) => title === 'Board Prep')).toHaveLength(1);

    h.setNow(new Date(T0.getTime() + 2 * 60 * 60_000));
    const { done } = await decide(h, approvalId);
    expect(done?.status).not.toBe('completed');
    expect(done?.steps?.[0]?.status).toBe('failed');
    // Still only the control's event: the expired resume created nothing.
    expect((await calendarTitles(h)).filter((title) => title === 'Board Prep')).toHaveLength(1);
    const resumed = h.recorder.records.filter((record) => record.approvalId === approvalId);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.agentIdentityId).toBe(agentId);
    expect(resumed[0]?.status).not.toBe('completed');
    expect(
      (await blockedFor(h, agentId)).some((event) => event.detail?.includes('DELEGATION_EXPIRED')),
    ).toBe(true);
  });

  it('an agent run can never decide an approval (self-approval) — the human still can', async () => {
    const h = await harness();
    const { agentId, approvalId } = await openApproval(h);

    const attempt = await executeOk(h, agentId, `Approve approval ${approvalId}`);
    expect(attempt.outcome.status).toBe('clarification');
    expect(attempt.outcome.steps).toEqual([]);

    const approvalRow = (await auditEvents(h, '&source=approval')).find(
      (event) => event.id === `apr:${approvalId}`,
    );
    expect(approvalRow?.status).toBe('awaiting_approval');
    expect(await calendarTitles(h)).not.toContain('Board Prep');

    // The human decision still works afterwards.
    const { done } = await decide(h, approvalId);
    expect(done?.status).toBe('completed');
    expect((await calendarTitles(h)).filter((title) => title === 'Board Prep')).toHaveLength(1);
  });
});
