/**
 * Prompt 9 — actor continuity and the run ↔ approval ↔ lineage join.
 *
 * A REAL chat approval flow with a DISTINCT approver (separation of duties via
 * the settings repository, as in approval-governance.decision.test.ts). The same
 * facts must agree across the approval row, the lineage, the Audit decision
 * trace and the runtime run; and an operator must be able to answer the nine
 * questions from `GET /api/ops/runtime/runs/:id` alone.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { buildBaseWorld } from '@nexora/evaluation';
import { fingerprintOf, type LineageRecord } from '@nexora/module-lineage';

import { createScenarioApp, type ScenarioApp } from '../evaluation/harness.js';

const AUTHORITY = 'POLICY_APPROVAL_AUTHORITY';
const CHAT = 'Create a calendar event titled Continuity Review tomorrow at 10am';

interface RunRow {
  id: string;
  actorId: string;
  status: string;
  approval?: { approvalId: string; state: string; decidedBy?: string; decision?: string };
  tools: { invocationId: string; approvalId?: string }[];
}

interface Governance {
  actors: {
    requester: { userId: string };
    agent?: { agentId: string };
    approver?: { userId: string; decidedAt: string };
    executor: { kind: string; userId: string; agentId?: string };
    executionAuthority: string;
  };
  approval?: {
    id: string;
    status: string;
    requesterId: string;
    approverId?: string;
    separationOfDuties: boolean;
    decidedAt?: string;
    approvedInputFingerprint: string;
  };
  policies: { policyId: string; outcome: string }[];
  executions: {
    invocationId: string;
    toolId?: string;
    status?: string;
    inputFingerprint?: string;
    matchesApproved?: boolean;
    verification: { verified: boolean; source: string; limitation?: string };
  }[];
  links: { auditEventId: string | null };
}

describe('actor continuity: requester ≠ approver across approval, lineage, trace and run', () => {
  let harness: ScenarioApp | undefined;
  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  async function flow() {
    harness = await createScenarioApp(buildBaseWorld());
    const app = harness;
    const orgId = app.world.organization('aurora').id;
    const wsId = app.world.workspace('aurora-eng').id;
    const meera = app.world.user('meera').id;
    const vikram = app.world.user('vikram').id;
    await app.repos.policySettings!.append({
      organizationId: orgId,
      policyId: AUTHORITY,
      config: { rules: [{ capabilityPrefix: 'calendar.', separationOfDuties: true }] },
      createdBy: meera,
    });
    const chat = await app.request('meera', 'POST', '/api/ai/chat', {
      message: CHAT,
      organizationId: orgId,
      workspaceId: wsId,
    });
    const approvalId = /"id":"(apr_[^"]+)"/.exec(chat.body)?.[1] as string;
    expect(approvalId).toBeTruthy();
    // Positive control first: nothing ran before a decision.
    const pendingRuns = await runs(app, orgId, wsId, `approvalId=${approvalId}`);
    expect(pendingRuns.every((run) => run.tools.length === 0)).toBe(true);
    const decided = await app.request(
      'vikram',
      'POST',
      `/api/ai/approvals/${approvalId}/decision`,
      {
        decision: 'approve',
      },
    );
    expect(decided.statusCode).toBe(200);
    return { app, orgId, wsId, meera, vikram, approvalId };
  }

  async function runs(app: ScenarioApp, orgId: string, wsId: string, filter: string) {
    const response = await app.request(
      'meera',
      'GET',
      `/api/ops/runtime/runs?organizationId=${orgId}&workspaceId=${wsId}&${filter}`,
    );
    expect(response.statusCode).toBe(200);
    return (response.json() as { runs: RunRow[] }).runs;
  }

  it('the approver is only ever descriptive; the requester is the actor everywhere', async () => {
    const { app, orgId, wsId, meera, vikram, approvalId } = await flow();

    // 1. The approval row.
    const approval = await app.approvals.byId(approvalId);
    expect(approval?.userId).toBe(meera);
    expect(approval?.decidedBy).toBe(vikram);
    expect(approval?.separationOfDuties).toBe(true);

    // 2. Lineage: actor = requester; the approver rides on approvedBy (descriptive).
    const records = await (
      app.repos.lineage as unknown as {
        list(t: string, q: object): Promise<readonly LineageRecord[]>;
      }
    ).list(orgId, { approvalId });
    const execution = records.find((r) => r.kind === 'EXECUTION');
    expect(execution?.actorId).toBe(meera);
    expect((execution?.data as { approvedBy?: { userId: string } }).approvedBy?.userId).toBe(
      vikram,
    );
    expect(records.filter((r) => r.actorId === vikram)).toHaveLength(0);
    const verification = records.find((r) => r.kind === 'VERIFICATION');
    expect(verification?.data).toMatchObject({ verified: true, source: 'state_readback' });

    // 3. The Audit decision trace.
    const traceResponse = await app.request(
      'meera',
      'GET',
      `/api/audit/events/apr:${approvalId}/trace?organizationId=${orgId}&workspaceId=${wsId}`,
    );
    expect(traceResponse.statusCode).toBe(200);
    const { trace } = traceResponse.json() as {
      trace: {
        actors: {
          requester: { userId: string; name?: string };
          approver?: { userId: string; name?: string };
          executor: { kind: string; userId: string };
          executionAuthority: string;
        };
        approval: {
          requester: string;
          decidedBy: string;
          separationOfDuties: boolean;
          expiresAt: string;
          inputFingerprint: string;
        };
        executions: {
          matchesApprovedInput?: boolean;
          verification?: { verified: boolean; source: string };
        }[];
      };
    };
    expect(trace.actors.requester).toMatchObject({ userId: meera, name: 'Meera Iyer' });
    expect(trace.actors.approver).toMatchObject({ userId: vikram, name: 'Vikram Singh' });
    expect(trace.actors.executor).toEqual({ kind: 'user', userId: meera });
    expect(trace.actors.executionAuthority).toBe('requester_rbac');
    expect(trace.approval).toMatchObject({
      requester: meera,
      decidedBy: vikram,
      separationOfDuties: true,
    });
    expect(trace.approval.expiresAt).toBeTruthy();
    // The traced fingerprint is the fingerprint of the STORED approval input.
    expect(trace.approval.inputFingerprint).toBe(fingerprintOf(approval?.input ?? {}));
    expect(trace.executions[0]).toMatchObject({
      matchesApprovedInput: true,
      verification: { verified: true, source: 'state_readback' },
    });
    // Secret-free: no raw input values.
    // (the derived start instant lives only in the stored approval input)
    expect(JSON.stringify(trace)).not.toContain('T10:00:00');

    // 4. The runtime run: actorId = requester; approval.decidedBy = approver.
    const resumed = (await runs(app, orgId, wsId, `approvalId=${approvalId}`)).find(
      (run) => run.approval?.state === 'resumed',
    );
    expect(resumed?.actorId).toBe(meera);
    expect(resumed?.approval?.decidedBy).toBe(vikram);
  });

  it('an operator answers the nine questions from /runs/:id; filters find the run', async () => {
    const { app, orgId, wsId, meera, vikram, approvalId } = await flow();
    const byApproval = await runs(app, orgId, wsId, `approvalId=${approvalId}`);
    // The opening run and the resumed run both correlate to the approval.
    expect(byApproval.map((run) => run.approval?.state).sort()).toEqual(['opened', 'resumed']);
    const resumed = byApproval.find((run) => run.approval?.state === 'resumed') as RunRow;
    const invocationId = resumed.tools[0]?.invocationId as string;
    // Filter by invocation returns exactly the executing run.
    expect((await runs(app, orgId, wsId, `invocationId=${invocationId}`)).map((r) => r.id)).toEqual(
      [resumed.id],
    );
    // Positive/negative control: an unknown id matches nothing.
    expect(await runs(app, orgId, wsId, 'approvalId=apr_unknown')).toHaveLength(0);
    expect(await runs(app, orgId, wsId, 'invocationId=inv_unknown')).toHaveLength(0);

    const detail = await app.request(
      'meera',
      'GET',
      `/api/ops/runtime/runs/${resumed.id}?organizationId=${orgId}&workspaceId=${wsId}`,
    );
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      governance: Governance;
      bottleneck?: unknown;
      timeline: { stage: string }[];
    };
    const g = body.governance;
    // (1) who initiated  (2) which agent  (5) who approved
    expect(g.actors.requester.userId).toBe(meera);
    expect(g.actors.agent).toBeUndefined();
    expect(g.actors.approver?.userId).toBe(vikram);
    expect(g.actors.executor).toEqual({ kind: 'user', userId: meera });
    // (3) which policy  (4) approval required
    expect(g.policies.some((p) => p.outcome === 'REQUIRE_APPROVAL')).toBe(true);
    expect(g.approval).toMatchObject({
      id: approvalId,
      status: 'completed',
      requesterId: meera,
      approverId: vikram,
      separationOfDuties: true,
    });
    // (6) what was approved (fingerprint only)  (7) what executed
    const stored = await app.approvals.byId(approvalId);
    expect(g.approval?.approvedInputFingerprint).toBe(fingerprintOf(stored?.input ?? {}));
    expect(g.executions).toHaveLength(1);
    expect(g.executions[0]).toMatchObject({
      invocationId,
      toolId: 'calendar.create_event',
      status: 'succeeded',
      inputFingerprint: g.approval?.approvedInputFingerprint,
      matchesApproved: true,
    });
    // (8) verified, with the source
    expect(g.executions[0]?.verification).toMatchObject({
      verified: true,
      source: 'state_readback',
    });
    // (9) where failed/slow: the run carries its timeline + bottleneck; link to the audit trace.
    expect(body.timeline.length).toBeGreaterThan(0);
    expect(g.links.auditEventId).toBe(`apr:${approvalId}`);
    // Never raw input/output.
    expect(JSON.stringify(g)).not.toContain('Continuity Review');
  });

  it('a foreign tenant cannot join: the run is 404 and correlation filters find nothing', async () => {
    const { app, orgId, wsId, approvalId } = await flow();
    const resumed = (await runs(app, orgId, wsId, `approvalId=${approvalId}`)).find(
      (run) => run.approval?.state === 'resumed',
    ) as RunRow;
    const foreignOrg = app.world.organization('borealis').id;
    const foreignWs = app.world.workspace('borealis-hq').id;
    // Positive control: the owner tenant can read it.
    const own = await app.request(
      'meera',
      'GET',
      `/api/ops/runtime/runs/${resumed.id}?organizationId=${orgId}&workspaceId=${wsId}`,
    );
    expect(own.statusCode).toBe(200);
    const foreign = await app.request(
      'lena',
      'GET',
      `/api/ops/runtime/runs/${resumed.id}?organizationId=${foreignOrg}&workspaceId=${foreignWs}`,
    );
    expect(foreign.statusCode).toBe(404);
    const foreignList = await app.request(
      'lena',
      'GET',
      `/api/ops/runtime/runs?organizationId=${foreignOrg}&workspaceId=${foreignWs}&approvalId=${approvalId}`,
    );
    expect(foreignList.statusCode).toBe(200);
    expect((foreignList.json() as { runs: unknown[] }).runs).toHaveLength(0);
  });
});
