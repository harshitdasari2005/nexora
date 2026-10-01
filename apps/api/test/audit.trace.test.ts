/**
 * Prompt 6 — the Audit Center decision trace
 * (`GET /api/audit/events/:eventId/trace`) through the REAL app.
 *
 * "Why did this happen, on what information, and what actually ran?" for an
 * approval (`apr:`), an agent run (`agx:`) and a workflow step (`wfs:`).
 * Every negative / denial assertion is paired with a positive control (same
 * setup, one factor changed) so no test can pass vacuously.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryApprovalEngine } from '@nexora/ai-runtime';
import {
  fingerprintOf,
  InMemoryLineageRepository,
  type LineageRecord,
  type LineageRepository,
} from '@nexora/module-lineage';

import { DecisionTraceService } from '../src/audit/decision-trace.js';
import { signInboundBody } from '../src/routes/integrations.js';
import {
  FakeAgentExecutionRecorder,
  FakeWorkflowInstanceRepository,
  FakeWorkflowStepExecutionRepository,
} from './fakes.js';
import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  parseSse,
  provisionAgent,
  seedProject,
  seedWorkspace,
  type ChatClient,
} from './helpers.js';

const CALENDAR = 'calendar.create_event';
const TITLE = 'Zebra Summit Nine';
const CHAT_WRITE = `Create a calendar event titled ${TITLE} tomorrow at 9am`;
/** Derived by the planner from "tomorrow at 9am" — present in the approved input, never in the message. */
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const DERIVED_START = `${TOMORROW}T09:00:00.000Z`;
const INBOUND_SECRET = 'test-inbound-secret';

interface TraceEvidence {
  evidenceId: string;
  sourceType: string;
  sourceId: string;
  trust?: string;
  fingerprint?: string;
  derived: boolean;
}

interface Trace {
  eventId: string;
  request: { text?: string; actorId?: string; organizationId: string; workspaceId?: string };
  evidence: TraceEvidence[];
  actors: {
    requester: { userId: string };
    agent?: { agentId: string; delegationId?: string };
    approver?: { userId: string; decidedAt: string };
    executor: { kind: string; userId: string; agentId?: string };
    executionAuthority: string;
  };
  authorization: { agentId?: string; delegationIds: string[]; origin?: string };
  policy?: {
    id: string;
    version: string;
    outcome: string;
    reason?: string;
    rules?: string[];
    contextFingerprint?: string;
  };
  approval?: { id: string; status: string; decidedBy?: string; inputFingerprint: string };
  planned: {
    stepId?: string;
    toolId?: string;
    inputFingerprint?: string;
    requiresApproval?: boolean;
    approvalId?: string;
  }[];
  executions: {
    invocationId?: string;
    toolId?: string;
    status?: string;
    verified?: boolean;
    inputFingerprint?: string;
    outputFingerprint?: string;
    affectedResource?: { type: string; id: string };
    approvalId?: string;
    matchesApprovedInput?: boolean;
    workflow?: { stepId?: string; purpose?: string };
  }[];
  lineage: { recordId: string; kind: string }[];
}

interface Env {
  client: ChatClient;
  organizationId: string;
  workspaceId: string;
  scope: string;
  lineage: LineageRepository;
}

const scopeOf = (organizationId: string, workspaceId: string): string =>
  `organizationId=${organizationId}&workspaceId=${workspaceId}`;

async function env(workspaceType?: string): Promise<Env> {
  const client = await chatClient({ agentExecutionRecorder: new FakeAgentExecutionRecorder() });
  const { organizationId, workspaceId } = await onboardOrgAndWorkspace(
    client,
    workspaceType === undefined ? undefined : { workspaceType },
  );
  return {
    client,
    organizationId,
    workspaceId,
    scope: scopeOf(organizationId, workspaceId),
    lineage: client.repos.lineage as LineageRepository,
  };
}

interface OpenedApproval {
  id: string;
  input: Record<string, unknown>;
}

async function openApproval(e: Env, message = CHAT_WRITE): Promise<OpenedApproval> {
  const raw = await e.client.post('/api/ai/chat', {
    message,
    organizationId: e.organizationId,
    workspaceId: e.workspaceId,
  });
  expect(raw.statusCode).toBe(200);
  const done = parseSse(raw.body).find((event) => event.event === 'done')?.data as {
    approvals: { id: string; status: string; toolId: string; input: Record<string, unknown> }[];
  };
  const approval = done.approvals[0];
  expect(approval?.status).toBe('pending');
  expect(approval?.toolId).toBe(CALENDAR);
  return { id: approval?.id ?? '', input: approval?.input ?? {} };
}

async function decide(e: Env, id: string, decision: 'approve' | 'reject'): Promise<void> {
  const response = await e.client.post(`/api/ai/approvals/${id}/decision`, { decision });
  expect(response.statusCode).toBe(200);
}

async function traceOf(e: Env, eventId: string): Promise<Trace> {
  const response = await e.client.get(`/api/audit/events/${eventId}/trace?${e.scope}`);
  expect(response.statusCode).toBe(200);
  return (response.json() as { trace: Trace }).trace;
}

/** The trace with the free-text request section removed (it legitimately echoes the user's message). */
function withoutRequest(trace: Trace): string {
  const { request: _request, ...rest } = trace;
  void _request;
  return JSON.stringify(rest);
}

/** A response body with the per-request id normalized so bodies are comparable byte for byte. */
const normalized = (body: string): string =>
  body.replace(/"requestId":"[^"]*"/g, '"requestId":"-"');

let seq = 0;
function record(
  over: Partial<LineageRecord> & Pick<LineageRecord, 'tenantId' | 'runId' | 'kind'>,
): LineageRecord {
  seq += 1;
  return {
    id: `lin_test_${seq}`,
    occurredAt: '2026-09-29T18:00:00.000Z',
    seq,
    data: {},
    ...over,
  };
}

/** The user's run id of an approval, via the trace's own record of it. */
async function runIdOf(e: Env, approvalId: string): Promise<string> {
  const planned = (await e.lineage.list(e.organizationId, { approvalId })).find(
    (r) => r.kind === 'PLANNED_ACTION',
  );
  expect(planned).toBeDefined();
  return planned?.runId ?? '';
}

describe('approval trace (apr:)', () => {
  it('shows planned-but-not-executed before approval, then the approved execution with every section', async () => {
    const e = await env();
    const approval = await openApproval(e);
    const id = `apr:${approval.id}`;

    const before = await traceOf(e, id);
    expect(before.eventId).toBe(id);
    expect(before.approval?.id).toBe(approval.id);
    expect(before.approval?.status).toBe('awaiting_approval');
    expect(before.planned).toHaveLength(1);
    expect(before.planned[0]).toMatchObject({
      toolId: CALENDAR,
      requiresApproval: true,
      approvalId: approval.id,
    });
    // A plan is not evidence that anything ran.
    expect(before.executions).toEqual([]);
    expect(before.lineage.map((r) => r.kind)).not.toContain('EXECUTION');

    await decide(e, approval.id, 'approve');

    const after = await traceOf(e, id);
    // request
    expect(after.request.text).toBe(CHAT_WRITE);
    expect(after.request.organizationId).toBe(e.organizationId);
    expect(after.request.workspaceId).toBe(e.workspaceId);
    expect(after.request.actorId).toBe(currentUserId(e.client));
    // policy: the decision recorded on the approval
    expect(after.policy).toMatchObject({
      id: 'POLICY_SIDE_EFFECT_APPROVAL',
      version: '1',
      outcome: 'REQUIRE_APPROVAL',
    });
    expect(after.policy?.rules?.join(',')).toContain('POLICY_SIDE_EFFECT_APPROVAL');
    // approval: the fingerprint of the exact approved arguments
    expect(after.approval?.status).toBe('completed');
    expect(after.approval?.decidedBy).toBe(currentUserId(e.client));
    expect(after.approval?.inputFingerprint).toBe(fingerprintOf(approval.input));
    // planned vs executed
    expect(after.planned.length).toBeGreaterThan(0);
    expect(
      after.planned.every((p) => p.inputFingerprint === after.approval?.inputFingerprint),
    ).toBe(true);
    expect(after.executions).toHaveLength(1);
    const execution = after.executions[0];
    expect(execution).toMatchObject({
      toolId: CALENDAR,
      status: 'succeeded',
      verified: true,
      approvalId: approval.id,
      matchesApprovedInput: true,
      inputFingerprint: after.approval?.inputFingerprint,
    });
    expect(execution?.invocationId).toMatch(/^inv_/);
    expect(execution?.affectedResource?.type).toBe('event');
    expect(execution?.affectedResource?.id).toMatch(/^cal_/);
    // lineage: the raw records behind the sections
    const kinds = after.lineage.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['PLANNED_ACTION', 'EXECUTION', 'VERIFICATION']));
  });

  it('a rejected approval traces to no execution (control: the approved one ran)', async () => {
    const e = await env();
    const rejected = await openApproval(
      e,
      'Create a calendar event titled Rejected Gala tomorrow at 9am',
    );
    const approved = await openApproval(e);
    await decide(e, rejected.id, 'reject');
    await decide(e, approved.id, 'approve');

    const rejectedTrace = await traceOf(e, `apr:${rejected.id}`);
    expect(rejectedTrace.approval?.status).toBe('rejected');
    expect(rejectedTrace.executions).toEqual([]);
    const approvedTrace = await traceOf(e, `apr:${approved.id}`);
    expect(approvedTrace.executions).toHaveLength(1);
    // The two runs do not bleed into each other.
    expect(approvedTrace.approval?.id).toBe(approved.id);
  });

  it('never carries raw approval input values or tool output (fingerprints only)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    // Positive control: the raw values exist where they are supposed to (the approval input).
    expect(JSON.stringify(approval.input)).toContain(TITLE);
    expect(JSON.stringify(approval.input)).toContain(DERIVED_START);
    await decide(e, approval.id, 'approve');

    const response = await e.client.get(`/api/audit/events/apr:${approval.id}/trace?${e.scope}`);
    const body = response.body;
    const trace = (response.json() as { trace: Trace }).trace;
    // The derived start time never appears anywhere; the title only in the request echo.
    expect(body).not.toContain(DERIVED_START);
    expect(withoutRequest(trace)).not.toContain(TITLE);
    expect(trace.request.text).toContain(TITLE);
    // The fingerprint stands in for the input.
    expect(trace.approval?.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(trace.executions[0]?.inputFingerprint).toBe(trace.approval?.inputFingerprint);
    expect(trace.executions[0]?.outputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Positive control: the tool really produced the event the trace points at (by id only).
    const storedIds = [
      ...(
        e.client.repos.calendarEvents as unknown as { entries: Map<string, unknown> }
      ).entries.keys(),
    ];
    expect(storedIds).toEqual([trace.executions[0]?.affectedResource?.id]);
    // The raw tool output (event status / end time) is not in the trace.
    expect(body).not.toContain('scheduled');
    expect(body).not.toContain(`${TOMORROW}T10:00:00.000Z`);
    expect(body).not.toContain('"output"');
    expect(body).not.toContain('"input"');
  });

  it('a foreign-tenant lineage record for the same run never appears (control: a same-tenant one does)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    const runId = await runIdOf(e, approval.id);
    await e.lineage.append([
      record({
        tenantId: e.organizationId,
        workspaceId: e.workspaceId,
        runId,
        kind: 'EVIDENCE',
        subjectType: 'DOCUMENT',
        subjectId: 'doc_own_extra',
        data: { sourceType: 'DOCUMENT', sourceId: 'doc_own_extra', derived: false },
      }),
      record({
        tenantId: 'org_alien_tenant',
        runId,
        kind: 'EVIDENCE',
        subjectType: 'DOCUMENT',
        subjectId: 'doc_alien_secret',
        data: { sourceType: 'DOCUMENT', sourceId: 'doc_alien_secret' },
      }),
      // A foreign LINK must not drag a foreign run's execution into this trace.
      record({
        tenantId: 'org_alien_tenant',
        runId,
        kind: 'LINK',
        data: { runId: 'run_alien_linked' },
      }),
      record({
        tenantId: 'org_alien_tenant',
        runId: 'run_alien_linked',
        kind: 'EXECUTION',
        data: { toolId: 'alien.tool', status: 'succeeded' },
      }),
    ]);
    const trace = await traceOf(e, `apr:${approval.id}`);
    expect(trace.evidence.map((item) => item.sourceId)).toContain('doc_own_extra');
    expect(JSON.stringify(trace)).not.toContain('doc_alien_secret');
    expect(JSON.stringify(trace)).not.toContain('alien.tool');
    expect(trace.executions.map((x) => x.toolId)).not.toContain('alien.tool');
  });

  it('follows a LINK exactly one hop (control: the same executions are absent without the LINK)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    const runId = await runIdOf(e, approval.id);
    const execution = (over: Partial<LineageRecord> & { runId: string; toolId: string }) =>
      record({
        tenantId: e.organizationId,
        workspaceId: e.workspaceId,
        kind: 'EXECUTION',
        invocationId: `inv_${over.toolId}`,
        data: {
          toolId: over.toolId,
          status: 'succeeded',
          origin: 'orchestrator',
          inputFingerprint: 'f'.repeat(64),
          completedAt: '2026-09-29T18:00:00.000Z',
        },
        ...over,
      });
    await e.lineage.append([
      execution({ runId: 'run_linked_a', toolId: 'linked.tool' }),
      execution({ runId: 'run_hop_two', toolId: 'hop2.tool' }),
    ]);

    // Control: nothing names those runs yet.
    const unlinked = await traceOf(e, `apr:${approval.id}`);
    expect(unlinked.executions.map((x) => x.toolId)).not.toContain('linked.tool');

    await e.lineage.append([
      record({
        tenantId: e.organizationId,
        workspaceId: e.workspaceId,
        runId,
        kind: 'LINK',
        data: { relation: 'STEP_RUN', runId: 'run_linked_a' },
      }),
      // A LINK inside the linked run is a second hop and is NOT followed.
      record({
        tenantId: e.organizationId,
        workspaceId: e.workspaceId,
        runId: 'run_linked_a',
        kind: 'LINK',
        data: { relation: 'STEP_RUN', runId: 'run_hop_two' },
      }),
    ]);
    const linked = await traceOf(e, `apr:${approval.id}`);
    expect(linked.executions.map((x) => x.toolId)).toContain('linked.tool');
    expect(linked.executions.map((x) => x.toolId)).not.toContain('hop2.tool');
    expect(linked.lineage.filter((r) => r.kind === 'LINK').length).toBeGreaterThanOrEqual(1);
  });

  it('flags an execution whose input differs from the approved input (control: the genuine one matches)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    await decide(e, approval.id, 'approve');
    const runId = await runIdOf(e, approval.id);
    const base = await traceOf(e, `apr:${approval.id}`);
    expect(base.executions.every((x) => x.matchesApprovedInput === true)).toBe(true);

    await e.lineage.append([
      record({
        tenantId: e.organizationId,
        workspaceId: e.workspaceId,
        runId,
        kind: 'EXECUTION',
        approvalId: approval.id,
        invocationId: 'inv_tampered',
        data: {
          toolId: CALENDAR,
          status: 'succeeded',
          inputFingerprint: fingerprintOf({ title: 'something else entirely' }),
          completedAt: '2026-09-29T18:00:00.000Z',
        },
      }),
    ]);
    const after = await traceOf(e, `apr:${approval.id}`);
    expect(after.executions).toHaveLength(2);
    expect(
      after.executions.find((x) => x.invocationId === 'inv_tampered')?.matchesApprovedInput,
    ).toBe(false);
    expect(after.executions.filter((x) => x.matchesApprovedInput === true)).toHaveLength(1);
  });

  it('returns derived FINDING records as derived:true and evidence as derived:false', async () => {
    const e = await env();
    const approval = await openApproval(e);
    const runId = await runIdOf(e, approval.id);
    await e.lineage.append([
      record({
        tenantId: e.organizationId,
        workspaceId: e.workspaceId,
        runId,
        kind: 'EVIDENCE',
        subjectType: 'KNOWLEDGE_ARTICLE',
        subjectId: 'kna_primary',
        fingerprint: 'a'.repeat(64),
        data: {
          sourceType: 'KNOWLEDGE_ARTICLE',
          sourceId: 'kna_primary',
          trust: 'KNOWLEDGE_CONTENT',
          sourceVersion: 3,
        },
      }),
      record({
        tenantId: e.organizationId,
        workspaceId: e.workspaceId,
        runId,
        kind: 'FINDING',
        subjectType: 'REMEDIATION_BASIS',
        subjectId: 'plan_x',
        data: { sourceType: 'REMEDIATION_BASIS', sourceId: 'plan_x', derived: true },
      }),
    ]);
    const trace = await traceOf(e, `apr:${approval.id}`);
    const primary = trace.evidence.find((item) => item.sourceId === 'kna_primary');
    const finding = trace.evidence.find((item) => item.sourceId === 'plan_x');
    expect(primary).toMatchObject({ derived: false, trust: 'KNOWLEDGE_CONTENT' });
    expect(primary?.fingerprint).toBe('a'.repeat(64));
    expect(finding?.derived).toBe(true);
    expect(finding?.sourceType).toBe('REMEDIATION_BASIS');
  });
});

describe('policy fallback (DecisionTraceService with real in-memory stores)', () => {
  function build() {
    const approvals = new InMemoryApprovalEngine();
    const lineage = new InMemoryLineageRepository();
    const service = new DecisionTraceService({
      approvals,
      lineage,
      workflowStepExecutions: new FakeWorkflowStepExecutionRepository(),
      workflowInstances: new FakeWorkflowInstanceRepository(),
    });
    const open = (runId: string, policy?: Parameters<typeof approvals.open>[0]['policy']) =>
      approvals.open({
        conversationId: 'conv_1',
        userId: 'usr_1',
        tenantId: 'org_t',
        workspaceId: 'wsp_1',
        runId,
        stepId: 'step_1',
        toolId: 'remediation.step',
        capabilityId: 'remediation.step',
        sideEffectClass: 'consequential',
        reason: 'needs approval',
        intent: 'remediate',
        input: { a: 1 },
        ...(policy === undefined ? {} : { policy }),
      });
    const planned = (runId: string, approvalId: string) =>
      record({
        tenantId: 'org_t',
        runId,
        kind: 'PLANNED_ACTION',
        approvalId,
        data: {
          toolId: 'remediation.step',
          stepId: 'step_1',
          policy: {
            policyId: 'POLICY_FROM_LINEAGE',
            version: '7',
            outcome: 'REQUIRE_APPROVAL',
            contextFingerprint: 'ctx-1',
          },
        },
      });
    return { approvals, lineage, service, open, planned };
  }

  it('an approval without a recorded policy takes the policy recorded in lineage', async () => {
    const { lineage, service, open, planned } = build();
    const bare = open('run_bare');
    await lineage.append([planned('run_bare', bare.id)]);
    const trace = await service.trace('org_t', `apr:${bare.id}`);
    expect(trace?.policy).toEqual({
      id: 'POLICY_FROM_LINEAGE',
      version: '7',
      outcome: 'REQUIRE_APPROVAL',
      contextFingerprint: 'ctx-1',
    });
  });

  it('control: an approval that carries its own policy keeps it (lineage is not consulted for the decision)', async () => {
    const { lineage, service, open, planned } = build();
    const own = open('run_own', {
      outcome: 'REQUIRE_APPROVAL',
      policyId: 'POLICY_ON_APPROVAL',
      version: '2',
      reasonCode: 'X',
      reason: 'recorded on the approval',
      fingerprint: 'fp',
      rules: ['POLICY_ON_APPROVAL@2=REQUIRE_APPROVAL'],
    });
    await lineage.append([planned('run_own', own.id)]);
    const trace = await service.trace('org_t', `apr:${own.id}`);
    expect(trace?.policy?.id).toBe('POLICY_ON_APPROVAL');
    expect(trace?.policy?.version).toBe('2');
    expect(trace?.policy?.reason).toBe('recorded on the approval');
    // Only the descriptive context digest is borrowed from lineage.
    expect(trace?.policy?.contextFingerprint).toBe('ctx-1');
  });

  it('control: no policy anywhere yields no policy section; a foreign tenant gets undefined', async () => {
    const { service, open } = build();
    const none = open('run_none');
    const trace = await service.trace('org_t', `apr:${none.id}`);
    expect(trace).toBeDefined();
    expect(trace?.policy).toBeUndefined();
    expect(await service.trace('org_other', `apr:${none.id}`)).toBeUndefined();
  });
});

describe('agent run trace (agx:)', () => {
  it('resolves the journaled agent run and exposes the agent id and delegation ids', async () => {
    const e = await env();
    const { agentId, delegationIds } = await provisionAgent(e.client.repos, {
      organizationId: e.organizationId,
      workspaceId: e.workspaceId,
      definitionId: 'executive',
      grantedBy: currentUserId(e.client),
      capabilityIds: [CALENDAR],
    });
    const run = await e.client.post(`/api/agents/${agentId}/execute?${e.scope}`, {
      utterance: CHAT_WRITE,
    });
    expect(run.statusCode).toBe(200);

    const listed = await e.client.get(`/api/audit/events?${e.scope}&limit=500`);
    const events = (listed.json() as { events: { id: string; source: string }[] }).events;
    const agx = events.find((event) => event.source === 'agent_execution');
    expect(agx?.id).toMatch(/^agx:/);

    const trace = await traceOf(e, agx?.id ?? '');
    expect(trace.eventId).toBe(agx?.id);
    expect(trace.authorization.agentId).toBe(agentId);
    expect(trace.authorization.delegationIds).toEqual(delegationIds);
    expect(trace.planned.some((p) => p.toolId === CALENDAR && p.requiresApproval === true)).toBe(
      true,
    );
    // Awaiting approval: nothing executed yet.
    expect(trace.executions).toEqual([]);

    // Once the approval is granted the run RESUMES as its own journaled agent
    // event; the original blocked run keeps its planned-only trace.
    const approvalId = trace.planned.find((p) => p.approvalId !== undefined)?.approvalId ?? '';
    expect(approvalId).toMatch(/^apr_/);
    await decide(e, approvalId, 'approve');
    const relisted = await e.client.get(`/api/audit/events?${e.scope}&limit=500`);
    const agxIds = (relisted.json() as { events: { id: string; source: string }[] }).events
      .filter((event) => event.source === 'agent_execution')
      .map((event) => event.id);
    const resumedId = agxIds.find((candidate) => candidate !== agx?.id);
    expect(resumedId).toMatch(/^agx:/);

    const resumed = await traceOf(e, resumedId ?? '');
    expect(resumed.authorization.agentId).toBe(agentId);
    expect(resumed.authorization.delegationIds).toEqual(delegationIds);
    expect(resumed.authorization.origin).toBe('agent');
    expect(resumed.approval?.id).toBe(approvalId);
    // The agent acts for the requester under its delegation; the approver (here the
    // same human) is descriptive and never the executor.
    expect(resumed.actors.agent?.agentId).toBe(agentId);
    expect(resumed.actors.executor).toMatchObject({ kind: 'agent', agentId });
    expect(resumed.actors.executionAuthority).toBe('agent_delegation');
    expect(resumed.actors.requester.userId).toBe(currentUserId(e.client));
    expect(resumed.executions).toHaveLength(1);
    expect(resumed.executions[0]).toMatchObject({
      toolId: CALENDAR,
      status: 'succeeded',
      approvalId,
      matchesApprovedInput: true,
    });
    // Control: the original blocked run still shows nothing executed.
    expect((await traceOf(e, agx?.id ?? '')).executions).toEqual([]);
  });

  it('control: a human chat approval trace names no agent', async () => {
    const e = await env();
    const approval = await openApproval(e);
    const trace = await traceOf(e, `apr:${approval.id}`);
    expect(trace.authorization.agentId).toBeUndefined();
    expect(trace.authorization.delegationIds).toEqual([]);
    expect(trace.actors.agent).toBeUndefined();
    expect(trace.actors.executor.kind).toBe('user');
    expect(trace.actors.executionAuthority).toBe('requester_rbac');
  });
});

describe('workflow step trace (wfs:)', () => {
  it('resolves a workflow step id and shows step executions with their purpose', async () => {
    const e = await env();
    await seedProject(e.client.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId: e.organizationId,
      name: 'Mobile Banking',
      status: 'active',
    });
    const started = await e.client.post('/api/workflows', {
      organizationId: e.organizationId,
      definitionKey: 'hr.hire_and_assign_employee',
      input: { employeeName: 'Sarah Chen', projectName: 'Mobile Banking' },
    });
    expect(started.statusCode).toBe(201);

    const listed = await e.client.get(
      `/api/audit/events?${e.scope}&limit=500&source=workflow_step`,
    );
    const steps = (listed.json() as { events: { id: string }[] }).events;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.id.startsWith('wfs:'))).toBe(true);

    const trace = await traceOf(e, steps[0]?.id ?? '');
    const tools = trace.executions.map((x) => x.toolId);
    expect(tools).toEqual(
      expect.arrayContaining([
        'hr.create_employee',
        'projects.find_project',
        'projects.assign_employee',
      ]),
    );
    for (const execution of trace.executions) {
      expect(execution.workflow?.purpose).toBe('step');
      expect(execution.workflow?.stepId).toBeTruthy();
      expect(execution.status).toBe('succeeded');
    }
    expect(trace.authorization.origin).toBe('workflow');
    // The project the find step read is recorded as evidence (id, not content).
    const evidence = trace.evidence.find((item) => item.sourceType === 'PROJECT');
    expect(evidence?.sourceId).toBe('prj_12345678-1234-1234-1234-123456789012');
    expect(evidence?.derived).toBe(false);
    expect(trace.request.actorId).toBe(currentUserId(e.client));

    // Control: an unknown wfs id has no trace.
    const unknown = await e.client.get(`/api/audit/events/wfs:wfx_unknown/trace?${e.scope}`);
    expect(unknown.statusCode).toBe(404);
  });
});

describe('authorization and tenant isolation', () => {
  it('a member without audit.read gets 403 (control: the audit.read workspace gets 200)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    // The same user also owns a finance workspace (CFO: no audit.read).
    const finance = await e.client.post('/api/workspaces', {
      organizationId: e.organizationId,
      name: 'Finance',
      slug: 'finance',
      type: 'finance',
    });
    expect(finance.statusCode).toBe(201);
    const financeId = (finance.json() as { workspace: { id: string } }).workspace.id;

    const denied = await e.client.get(
      `/api/audit/events/apr:${approval.id}/trace?${scopeOf(e.organizationId, financeId)}`,
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: expect.any(String) } });
    expect(denied.body).not.toContain(approval.id);
    expect(denied.body).not.toContain('inputFingerprint');

    const allowed = await e.client.get(`/api/audit/events/apr:${approval.id}/trace?${e.scope}`);
    expect(allowed.statusCode).toBe(200);
  });

  it('a non-member of the workspace or organization gets 403 (control: the member gets 200)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    await seedWorkspace(e.client.repos, {
      id: 'wsp_not_a_member',
      organizationId: e.organizationId,
      slug: 'secret-ws',
    });
    const url = (query: string) => `/api/audit/events/apr:${approval.id}/trace?${query}`;

    const notWorkspaceMember = await e.client.get(
      url(scopeOf(e.organizationId, 'wsp_not_a_member')),
    );
    expect(notWorkspaceMember.statusCode).toBe(403);
    const notOrgMember = await e.client.get(url(scopeOf('org_alien_0000', e.workspaceId)));
    expect(notOrgMember.statusCode).toBe(403);
    expect(notOrgMember.body).not.toContain('inputFingerprint');

    expect((await e.client.get(url(e.scope))).statusCode).toBe(200);
  });

  it('missing query parameters are 400 (control: complete parameters are 200)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    const base = `/api/audit/events/apr:${approval.id}/trace`;

    const noWorkspace = await e.client.get(`${base}?organizationId=${e.organizationId}`);
    expect(noWorkspace.statusCode).toBe(400);
    expect(noWorkspace.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    const noOrg = await e.client.get(`${base}?workspaceId=${e.workspaceId}`);
    expect(noOrg.statusCode).toBe(400);
    const none = await e.client.get(base);
    expect(none.statusCode).toBe(400);

    expect((await e.client.get(`${base}?${e.scope}`)).statusCode).toBe(200);
  });

  it('an unauthenticated caller is rejected (control: the session is accepted)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    const url = `/api/audit/events/apr:${approval.id}/trace?${e.scope}`;
    const anonymous = await e.client.app.inject({ method: 'GET', url });
    expect(anonymous.statusCode).toBe(401);
    expect((await e.client.get(url)).statusCode).toBe(200);
  });

  it('an id from another tenant is byte-identical to an unknown id (404, no leakage)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    const other = await e.client.post('/api/organizations', {
      name: 'Beta Inc.',
      slug: 'beta',
      type: 'startup',
    });
    expect(other.statusCode).toBe(201);
    const otherOrg = (other.json() as { organization: { id: string } }).organization.id;
    const otherWs = await e.client.post('/api/workspaces', {
      organizationId: otherOrg,
      name: 'Ops',
      slug: 'ops',
      type: 'engineering',
    });
    expect(otherWs.statusCode).toBe(201);
    const otherScope = scopeOf(
      otherOrg,
      (otherWs.json() as { workspace: { id: string } }).workspace.id,
    );

    // Positive control: in its own tenant the approval resolves.
    expect(
      (await e.client.get(`/api/audit/events/apr:${approval.id}/trace?${e.scope}`)).statusCode,
    ).toBe(200);

    const foreign = await e.client.get(`/api/audit/events/apr:${approval.id}/trace?${otherScope}`);
    const unknown = await e.client.get(
      `/api/audit/events/apr:apr_does_not_exist/trace?${otherScope}`,
    );
    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(normalized(foreign.body).replace(approval.id, 'apr_does_not_exist')).toBe(
      normalized(unknown.body),
    );
    expect(foreign.body).not.toContain(approval.id);
    expect(foreign.body).not.toContain('inputFingerprint');

    // The other prefixes behave the same for foreign / unknown ids.
    for (const eventId of ['agx:agx_missing', 'wfs:wfx_missing', 'act:missing', 'bogus']) {
      expect(
        (await e.client.get(`/api/audit/events/${eventId}/trace?${otherScope}`)).statusCode,
      ).toBe(404);
    }
  });
});

describe('inbound signed email evidence', () => {
  interface InboundBody {
    organizationId: string;
    workspaceId: string;
    messageId: string;
    from: string;
    action: string;
    targetId: string;
    decision?: string;
    text?: string;
  }

  function senderEmail(e: Env): string {
    const users = [
      ...(
        e.client.repos.users as unknown as { users: Map<string, { email: { value: string } }> }
      ).users.values(),
    ];
    return users[0]?.email.value ?? '';
  }

  function inbound(e: Env, body: InboundBody, signature?: string) {
    const payload = JSON.stringify(body);
    return e.client.app.inject({
      method: 'POST',
      url: '/api/integrations/email/inbound',
      headers: {
        'content-type': 'application/json',
        ...(signature === undefined ? {} : { 'x-nexora-inbound-signature': signature }),
      },
      payload,
    });
  }

  const signed = (body: InboundBody): string =>
    signInboundBody(INBOUND_SECRET, JSON.stringify(body));

  const inboundRecords = async (e: Env): Promise<LineageRecord[]> =>
    (await e.lineage.list(e.organizationId, { subjectType: 'INBOUND_MESSAGE' })) as LineageRecord[];

  function message(e: Env, approvalId: string, over: Partial<InboundBody> = {}): InboundBody {
    return {
      organizationId: e.organizationId,
      workspaceId: e.workspaceId,
      messageId: 'msg_trace_1',
      from: senderEmail(e),
      action: 'approval.decide',
      targetId: approvalId,
      ...over,
    };
  }

  it('a validly signed message appends exactly one EXTERNAL_CONTENT evidence record without the raw sender', async () => {
    const e = await env();
    const approval = await openApproval(e);
    expect(senderEmail(e)).toContain('@');
    expect(await inboundRecords(e)).toEqual([]);

    const body = message(e, approval.id, { decision: 'reject' });
    const response = await inbound(e, body, signed(body));
    expect(response.statusCode).toBe(200);

    const records = await inboundRecords(e);
    expect(records).toHaveLength(1);
    const evidence = records[0] as LineageRecord;
    expect(evidence.kind).toBe('EVIDENCE');
    expect(evidence.subjectId).toBe('msg_trace_1');
    expect(evidence.approvalId).toBe(approval.id);
    expect(evidence.data).toMatchObject({
      sourceType: 'INBOUND_MESSAGE',
      trust: 'EXTERNAL_CONTENT',
      signature: 'verified',
      outcome: 'processed',
      action: 'approval.decide',
    });
    expect(evidence.data['senderFingerprint']).toBe(fingerprintOf(senderEmail(e).toLowerCase()));
    // The sender address is never stored raw, in the record or in the trace.
    expect(JSON.stringify(evidence)).not.toContain(senderEmail(e));
    const trace = await traceOf(e, `apr:${approval.id}`);
    const seen = trace.evidence.find((item) => item.sourceType === 'INBOUND_MESSAGE');
    expect(seen).toMatchObject({
      sourceId: 'msg_trace_1',
      trust: 'EXTERNAL_CONTENT',
      derived: false,
    });
    expect(JSON.stringify(trace)).not.toContain(senderEmail(e));
    // The verified processing (reject) is what decided the approval.
    expect(trace.approval?.status).toBe('rejected');
  });

  it('an unsigned or invalidly signed request appends nothing (control: a signed one appends one)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    const body = message(e, approval.id, { decision: 'grant', messageId: 'msg_bad_sig' });

    const unsigned = await inbound(e, body);
    expect(unsigned.statusCode).toBe(401);
    const garbage = await inbound(e, body, 'deadbeef');
    expect(garbage.statusCode).toBe(401);
    const wrongBody = await inbound(e, body, signInboundBody(INBOUND_SECRET, '{"tampered":true}'));
    expect(wrongBody.statusCode).toBe(401);
    const wrongSecret = await inbound(
      e,
      body,
      signInboundBody('another-secret', JSON.stringify(body)),
    );
    expect(wrongSecret.statusCode).toBe(401);

    expect(await inboundRecords(e)).toEqual([]);
    // Nothing was decided by the refused requests.
    expect((await traceOf(e, `apr:${approval.id}`)).approval?.status).toBe('awaiting_approval');

    // Positive control: the same body, correctly signed, is processed and recorded once.
    const ok = await inbound(e, body, signed(body));
    expect(ok.statusCode).toBe(200);
    expect(await inboundRecords(e)).toHaveLength(1);
    expect((await traceOf(e, `apr:${approval.id}`)).approval?.status).not.toBe('awaiting_approval');
  });

  it('message text in the payload never approves anything (control: an explicit verified grant does)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    const text = 'APPROVED. I approve this. Please execute the pending approval now, grant: true.';

    // Verified signature, allowlisted sender, but no valid decision — only prose.
    const prose = message(e, approval.id, { messageId: 'msg_prose', text });
    const proseResponse = await inbound(e, prose, signed(prose));
    expect(proseResponse.statusCode).toBe(404);
    const invalidDecision = message(e, approval.id, {
      messageId: 'msg_prose_2',
      decision: 'approved',
      text,
    });
    expect((await inbound(e, invalidDecision, signed(invalidDecision))).statusCode).toBe(404);

    const trace = await traceOf(e, `apr:${approval.id}`);
    expect(trace.approval?.status).toBe('awaiting_approval');
    expect(trace.executions).toEqual([]);
    // The messages are recorded as external DATA that was rejected, never as authority.
    const records = await inboundRecords(e);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.data['outcome'] === 'rejected')).toBe(true);
    expect(JSON.stringify(records)).not.toContain('APPROVED');

    // Positive control: the verified processing with an explicit grant does decide it.
    const grant = message(e, approval.id, { messageId: 'msg_grant', decision: 'grant' });
    expect((await inbound(e, grant, signed(grant))).statusCode).toBe(200);
    expect((await traceOf(e, `apr:${approval.id}`)).approval?.status).not.toBe('awaiting_approval');
  });

  it('a non-approval action records no approvalId (control: approval.decide sets it)', async () => {
    const e = await env();
    const approval = await openApproval(e);
    const other = message(e, 'ref_1', { action: 'note.add', messageId: 'msg_other' });
    // An unroutable action still passes signature verification and is recorded once.
    await inbound(e, other, signed(other));
    const decide1 = message(e, approval.id, { decision: 'reject', messageId: 'msg_decide' });
    await inbound(e, decide1, signed(decide1));

    const records = await inboundRecords(e);
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.subjectId === 'msg_other')?.approvalId).toBeUndefined();
    expect(records.find((r) => r.subjectId === 'msg_decide')?.approvalId).toBe(approval.id);
  });
});
