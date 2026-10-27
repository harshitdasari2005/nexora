/**
 * Prompt 8 — approval governance at the decision surface.
 *
 * Drives the REAL app (evaluation world: Meera CEO + Vikram delivery.manager +
 * Arjun developer in aurora-eng, Rahul CFO in aurora-fin, Lena in another
 * organization) through the chat → approval → decision flow with the
 * POLICY_APPROVAL_AUTHORITY configuration written through the settings
 * repository. Every refusal is paired with a positive control.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { buildBaseWorld } from '@nexora/evaluation';

import { createScenarioApp, type ScenarioApp } from '../evaluation/harness.js';

const AUTHORITY = 'POLICY_APPROVAL_AUTHORITY';
const CHAT = 'Create a calendar event titled Governance Review tomorrow at 10am';

interface DonePayload {
  status: string;
  approvals: {
    id?: string;
    expiresAt?: string;
    requiredApproverRoleId?: string;
    separationOfDuties?: boolean;
  }[];
  steps: { status: string; errorCode?: string }[];
}

interface AuditEvent {
  source: string;
  status: string;
  action: string;
  detail?: string;
}

interface PendingApproval {
  id: string;
  requesterId: string;
  requesterName?: string;
  status: string;
  expiresAt: string;
  requiredApproverRoleId?: string;
  separationOfDuties: boolean;
  policy?: { policyId: string; version: string; outcome: string };
  canDecide: boolean;
  denyReason?: string;
}

function parseDone(body: string): DonePayload | undefined {
  const frame = body
    .split('\n\n')
    .map((part) => part.split('\n'))
    .find((lines) => lines[0] === 'event: done');
  return frame === undefined
    ? undefined
    : (JSON.parse(frame[1]!.slice('data: '.length)) as DonePayload);
}

describe('approval governance — decide authority, expiry, pending list', () => {
  let harness: ScenarioApp | undefined;
  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  async function setup() {
    harness = await createScenarioApp(buildBaseWorld());
    const app = harness;
    const orgId = app.world.organization('aurora').id;
    const wsId = app.world.workspace('aurora-eng').id;
    return { app, orgId, wsId };
  }

  async function configure(
    app: ScenarioApp,
    orgId: string,
    rules: Record<string, unknown>[],
  ): Promise<void> {
    await app.repos.policySettings!.append({
      organizationId: orgId,
      policyId: AUTHORITY,
      config: { rules },
      createdBy: app.world.user('meera').id,
    });
  }

  async function open(app: ScenarioApp, orgId: string, wsId: string, requester = 'meera') {
    const response = await app.request(requester, 'POST', '/api/ai/chat', {
      message: CHAT,
      organizationId: orgId,
      workspaceId: wsId,
    });
    const done = parseDone(response.body);
    const approval = done?.approvals[0];
    if (approval?.id === undefined) throw new Error(`no approval opened: ${response.body}`);
    return approval as { id: string; expiresAt?: string };
  }

  const decide = (
    app: ScenarioApp,
    user: string,
    id: string,
    body: Record<string, unknown> = { decision: 'approve' },
  ) => app.request(user, 'POST', `/api/ai/approvals/${id}/decision`, body);

  const eventsCreated = async (app: ScenarioApp, orgId: string, wsId: string) =>
    (await app.repos.calendarEvents.listByWorkspace(orgId as never, wsId as never)).filter(
      (event) => event.title.value === 'Governance Review',
    );

  async function audit(app: ScenarioApp, orgId: string, wsId: string): Promise<AuditEvent[]> {
    const response = await app.request(
      'meera',
      'GET',
      `/api/audit/events?organizationId=${orgId}&workspaceId=${wsId}`,
    );
    return (response.json() as { events: AuditEvent[] }).events;
  }

  async function pending(
    app: ScenarioApp,
    user: string,
    orgId: string,
    wsId: string,
  ): Promise<PendingApproval[]> {
    const response = await app.request(
      user,
      'GET',
      `/api/approvals/pending?organizationId=${orgId}&workspaceId=${wsId}`,
    );
    expect(response.statusCode).toBe(200);
    return (response.json() as { approvals: PendingApproval[] }).approvals;
  }

  it('legacy (no configuration): only the requester decides; behaviour unchanged', async () => {
    const { app, orgId, wsId } = await setup();
    const approval = await open(app, orgId, wsId);
    // The SSE approval DTO carries the governance fields (defaults).
    const list = await pending(app, 'meera', orgId, wsId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: approval.id,
      canDecide: true,
      separationOfDuties: false,
      requesterName: 'Meera Iyer',
    });
    expect(list[0]?.requiredApproverRoleId).toBeUndefined();

    const vikramView = await pending(app, 'vikram', orgId, wsId);
    expect(vikramView[0]).toMatchObject({ canDecide: false, denyReason: 'NOT_REQUESTER' });

    const refused = await decide(app, 'vikram', approval.id);
    expect(refused.statusCode).toBe(403);
    expect(await eventsCreated(app, orgId, wsId)).toHaveLength(0);

    const granted = await decide(app, 'meera', approval.id);
    expect(granted.statusCode).toBe(200);
    expect(await eventsCreated(app, orgId, wsId)).toHaveLength(1);
    expect(await pending(app, 'meera', orgId, wsId)).toHaveLength(0);
  });

  it('separation of duties: self-approval is blocked and audited; a distinct approver runs it AS the requester', async () => {
    const { app, orgId, wsId } = await setup();
    await configure(app, orgId, [{ capabilityPrefix: 'calendar.', separationOfDuties: true }]);
    const approval = await open(app, orgId, wsId);

    const meeraView = (await pending(app, 'meera', orgId, wsId))[0];
    expect(meeraView).toMatchObject({
      canDecide: false,
      denyReason: 'SELF_APPROVAL_FORBIDDEN',
      separationOfDuties: true,
      policy: { outcome: 'REQUIRE_APPROVAL' },
    });
    expect((await pending(app, 'vikram', orgId, wsId))[0]).toMatchObject({ canDecide: true });
    // A developer (no approvals.decide) cannot decide.
    expect((await pending(app, 'arjun', orgId, wsId))[0]).toMatchObject({
      canDecide: false,
      denyReason: 'DECIDE_NOT_PERMITTED',
    });

    const self = await decide(app, 'meera', approval.id);
    expect(self.statusCode).toBe(403);
    expect(await eventsCreated(app, orgId, wsId)).toHaveLength(0);
    const blocked = (await audit(app, orgId, wsId)).filter(
      (event) => event.status === 'blocked' && event.detail?.includes('SELF_APPROVAL_FORBIDDEN'),
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.detail).toContain('action: approval.decide');

    // Positive control: a different approver holding approvals.decide succeeds.
    const other = await decide(app, 'vikram', approval.id);
    expect(other.statusCode).toBe(200);
    const created = await eventsCreated(app, orgId, wsId);
    expect(created).toHaveLength(1);
    // Executed AS the requester (Meera), never the approver.
    expect(created[0]?.createdBy).toBe(app.world.user('meera').id);
    const lifecycle = (await audit(app, orgId, wsId)).filter((event) =>
      event.action.includes('Approval granted'),
    );
    expect(lifecycle.length).toBeGreaterThanOrEqual(1);
  });

  it('required approver role: a wrong role is refused (requester included); the right role succeeds', async () => {
    const { app, orgId, wsId } = await setup();
    await configure(app, orgId, [
      { capabilityPrefix: 'calendar.', requiredApproverRoleId: 'delivery.manager' },
    ]);
    const approval = await open(app, orgId, wsId);

    // The DTO the chat stream returned carries the requirement.
    const view = (await pending(app, 'meera', orgId, wsId))[0];
    expect(view).toMatchObject({
      requiredApproverRoleId: 'delivery.manager',
      canDecide: false,
      denyReason: 'WRONG_APPROVER_ROLE',
    });

    // The requester (CEO) holds approvals.decide but not the required role.
    const wrong = await decide(app, 'meera', approval.id);
    expect(wrong.statusCode).toBe(403);
    // Forged body fields never change who the decider is or what role counts.
    const forged = await decide(app, 'meera', approval.id, {
      decision: 'approve',
      role: 'delivery.manager',
      roleId: 'delivery.manager',
      approverRoleId: 'delivery.manager',
      approver: app.world.user('vikram').id,
      decidedBy: app.world.user('vikram').id,
      authority: 'admin',
    });
    expect([400, 403]).toContain(forged.statusCode);
    expect(await eventsCreated(app, orgId, wsId)).toHaveLength(0);
    const blocked = (await audit(app, orgId, wsId)).filter(
      (event) => event.status === 'blocked' && event.detail?.includes('WRONG_APPROVER_ROLE'),
    );
    expect(blocked.length).toBeGreaterThanOrEqual(1);

    // Positive control: the delivery manager (real role) decides — even with a
    // forged, different role in the body.
    const right = await decide(app, 'vikram', approval.id, {
      decision: 'approve',
      role: 'executive.ceo',
    });
    expect(right.statusCode).toBe(200);
    expect(await eventsCreated(app, orgId, wsId)).toHaveLength(1);
  });

  it('expiry: decide answers 410 idempotently, publishes approval.expired once, and never executes', async () => {
    const { app, orgId, wsId } = await setup();
    await configure(app, orgId, [
      { capabilityPrefix: 'calendar.', separationOfDuties: true, ttlMinutes: 5 },
    ]);
    const approval = await open(app, orgId, wsId);
    expect(approval.expiresAt).toBeDefined();

    app.setAgentClock(new Date(Date.parse(buildBaseWorld().referenceTime) + 60 * 60 * 1000));
    const first = await decide(app, 'vikram', approval.id);
    expect(first.statusCode).toBe(410);
    expect(first.json()).toMatchObject({ error: { code: 'APPROVAL_EXPIRED' } });
    const second = await decide(app, 'vikram', approval.id);
    expect(second.statusCode).toBe(410);
    const requester = await decide(app, 'meera', approval.id, { decision: 'reject' });
    expect(requester.statusCode).toBe(410);

    expect(await eventsCreated(app, orgId, wsId)).toHaveLength(0);
    expect(await pending(app, 'vikram', orgId, wsId)).toHaveLength(0);
    const expired = (await audit(app, orgId, wsId)).filter(
      (event) => event.source === 'activity' && event.status === 'expired',
    );
    expect(expired).toHaveLength(1);
  });

  it('a policy change after the approval blocks the resume (POLICY_CHANGED_AFTER_APPROVAL)', async () => {
    const { app, orgId, wsId } = await setup();
    await configure(app, orgId, [{ capabilityPrefix: 'calendar.', separationOfDuties: true }]);
    const approval = await open(app, orgId, wsId);
    // A NEW configuration version lands while the approval is pending.
    await app.repos.policySettings!.append({
      organizationId: orgId,
      policyId: AUTHORITY,
      config: {
        rules: [{ capabilityPrefix: 'calendar.', separationOfDuties: true, ttlMinutes: 30 }],
      },
      createdBy: app.world.user('meera').id,
    });
    const decided = await decide(app, 'vikram', approval.id);
    expect(decided.statusCode).toBe(200);
    const done = parseDone(decided.body);
    expect(done?.steps.some((step) => step.errorCode === 'POLICY_CHANGED_AFTER_APPROVAL')).toBe(
      true,
    );
    expect(await eventsCreated(app, orgId, wsId)).toHaveLength(0);
  });

  it('tenant / workspace isolation: another org, another workspace and non-members are refused', async () => {
    const { app, orgId, wsId } = await setup();
    await configure(app, orgId, [{ capabilityPrefix: 'calendar.', separationOfDuties: true }]);
    const approval = await open(app, orgId, wsId);

    // Lena belongs to a DIFFERENT organization. No standing → the approval is
    // reported exactly like a missing one (404, F-008: no existence oracle).
    const foreign = await decide(app, 'lena', approval.id);
    expect(foreign.statusCode).toBe(404);
    // Rahul is an org member and holds approvals.decide, but is not a member of
    // the approval's workspace (aurora-eng): the same 404.
    const otherWorkspace = await decide(app, 'rahul', approval.id);
    expect(otherWorkspace.statusCode).toBe(404);
    expect(await eventsCreated(app, orgId, wsId)).toHaveLength(0);

    // The pending list is scoped the same way.
    const foreignList = await app.request(
      'lena',
      'GET',
      `/api/approvals/pending?organizationId=${orgId}&workspaceId=${wsId}`,
    );
    expect(foreignList.statusCode).toBe(403);
    const wrongWorkspaceList = await app.request(
      'rahul',
      'GET',
      `/api/approvals/pending?organizationId=${orgId}&workspaceId=${wsId}`,
    );
    expect(wrongWorkspaceList.statusCode).toBe(403);
    const otherWs = app.world.workspace('aurora-exec').id;
    expect(await pending(app, 'meera', orgId, otherWs)).toHaveLength(0);

    // Positive control.
    expect((await decide(app, 'vikram', approval.id)).statusCode).toBe(200);
  });

  it('F-008: an approval id probed without standing is indistinguishable from a missing id (and the refusal is audited in the approval’s own tenant only)', async () => {
    const { app, orgId, wsId } = await setup();
    await configure(app, orgId, [{ capabilityPrefix: 'calendar.', separationOfDuties: true }]);
    const approval = await open(app, orgId, wsId);
    const blockedDecisions = async () =>
      (await audit(app, orgId, wsId)).filter(
        (e) => e.source === 'activity' && e.status === 'blocked',
      );
    const before = (await blockedDecisions()).length;

    const missing = await decide(app, 'lena', 'apr_00000000-0000-0000-0000-000000000000');
    const foreignOrg = await decide(app, 'lena', approval.id);
    const otherWorkspace = await decide(app, 'rahul', approval.id);
    const strip = (r: { json(): unknown }) => {
      const body = r.json() as { error: Record<string, unknown> };
      return { ...body.error, requestId: undefined };
    };
    // Same status and same body for: no such approval / another organization's
    // approval / an approval in a workspace the caller is not a member of.
    expect(missing.statusCode).toBe(404);
    expect(foreignOrg.statusCode).toBe(404);
    expect(otherWorkspace.statusCode).toBe(404);
    expect(strip(foreignOrg)).toEqual(strip(missing));
    expect(strip(otherWorkspace)).toEqual(strip(missing));
    // The documented defender-side record: each refused attempt on the REAL
    // approval is audited in the approval's own tenant (never the prober's);
    // the missing id has no tenant to record in.
    expect((await blockedDecisions()).length).toBe(before + 2);
    // …and nothing changed: the approval is still pending and decidable.
    expect(await eventsCreated(app, orgId, wsId)).toHaveLength(0);

    // A legitimate MEMBER who is refused (the requester under separation of
    // duties) still gets the specific 403 and the audit record.
    const refused = await decide(app, 'meera', approval.id);
    expect(refused.statusCode).toBe(403);
    expect((await blockedDecisions()).length).toBe(before + 3);

    // Positive control: the authorized approver still decides normally.
    expect((await decide(app, 'vikram', approval.id)).statusCode).toBe(200);
  });

  it('F-008: a LEGACY (non-governed) approval does not leak to an outsider through the requester rule either', async () => {
    const { app, orgId, wsId } = await setup();
    // No policy configured → the legacy "only the requester decides" rule applies.
    const approval = await open(app, orgId, wsId);
    const blocked = async () =>
      (await audit(app, orgId, wsId)).filter(
        (e) => e.source === 'activity' && e.status === 'blocked',
      );
    const before = (await blocked()).length;
    const missing = await decide(app, 'lena', 'apr_00000000-0000-0000-0000-000000000001');
    const foreign = await decide(app, 'lena', approval.id);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({
      error: {
        ...(missing.json() as { error: Record<string, unknown> }).error,
        requestId: (foreign.json() as { error: { requestId: string } }).error.requestId,
      },
    });
    expect((await blocked()).length).toBe(before + 1); // audited in the approval's tenant
    // A member who is not the requester still gets the specific refusal + audit.
    expect((await decide(app, 'vikram', approval.id)).statusCode).toBe(403);
    expect((await blocked()).length).toBe(before + 2);
    // The requester decides normally.
    expect((await decide(app, 'meera', approval.id)).statusCode).toBe(200);
  });

  it('an already-decided approval is 409 (not 410) and publishes no expiry', async () => {
    const { app, orgId, wsId } = await setup();
    await configure(app, orgId, [{ capabilityPrefix: 'calendar.', separationOfDuties: true }]);
    const approval = await open(app, orgId, wsId);
    expect((await decide(app, 'vikram', approval.id, { decision: 'reject' })).statusCode).toBe(200);
    expect((await decide(app, 'vikram', approval.id)).statusCode).toBe(409);
    expect((await audit(app, orgId, wsId)).filter((e) => e.status === 'expired')).toHaveLength(0);
  });
});
