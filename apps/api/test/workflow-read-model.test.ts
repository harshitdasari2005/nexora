/**
 * The composite-workflow read model: one truthful state vocabulary, derived
 * from the journal, rollback ledger, approval and lineage. A failed,
 * compensated or partial workflow can never read as completed/verified, and
 * no raw step inputs/outputs are exposed.
 */

import { describe, expect, it } from 'vitest';
import type { WorkflowExecutionRecord } from '@nexora/contracts/workflow';

import { FakeOidcGateway } from './fakes.js';
import {
  buildTestApp,
  login,
  onboardOrgAndWorkspace,
  parseSse,
  seedProject,
  type ChatClient,
} from './helpers.js';
import {
  approvalOnlyView,
  buildWorkflowRecordView,
  deriveInstanceState,
} from '../src/routes/workflow-read-model.js';

const NOW = '2026-01-01T00:00:00.000Z';

function record(
  status: string,
  compensation?: { status: string; compensatedSteps?: string[]; outstanding?: never[] },
): WorkflowExecutionRecord {
  return {
    instance: {
      id: 'wfi_1',
      definitionId: 'd',
      definitionKey: 'hr.hire_and_assign_employee',
      tenantId: 'org_1',
      userId: 'usr_1',
      correlationId: 'run_1',
      status,
      startedAt: NOW,
      ...(compensation === undefined
        ? {}
        : {
            compensation: {
              status: compensation.status,
              compensatedSteps: compensation.compensatedSteps ?? [],
              outstanding: compensation.outstanding ?? [],
            },
          }),
    },
    steps: [
      {
        id: 'wfx_1',
        workflowId: 'wfi_1',
        tenantId: 'org_1',
        stepId: 'hire_employee',
        name: 'Hire',
        capabilityId: 'hr.create_employee',
        toolId: 'hr.create_employee',
        status: 'succeeded',
        attempt: 1,
        executionKey: 'k',
        input: { secret: 'RAW-INPUT' },
        output: { secret: 'RAW-OUTPUT' },
        startedAt: NOW,
      },
    ],
  } as unknown as WorkflowExecutionRecord;
}

function lineage(source: string, verified: boolean) {
  return [
    {
      id: 'lin_1',
      tenantId: 'org_1',
      runId: 'run_1',
      kind: 'EXECUTION',
      occurredAt: NOW,
      seq: 1,
      invocationId: 'inv_1',
      data: { status: 'succeeded', workflow: { stepId: 'hire_employee', purpose: 'step' } },
    },
    {
      id: 'lin_2',
      tenantId: 'org_1',
      runId: 'run_1',
      kind: 'VERIFICATION',
      occurredAt: NOW,
      seq: 2,
      invocationId: 'inv_1',
      data: { of: 'inv_1', verified, method: source, source, limitation: 'handler said so' },
    },
  ] as never;
}

const sideEffectOf = () => 'consequential' as const;

describe('workflow state derivation (pure)', () => {
  it('succeeded + state read-back on every counted step => verified', () => {
    const view = buildWorkflowRecordView({
      record: record('succeeded'),
      lineage: lineage('state_readback', true),
      sideEffectOf,
    });
    expect(view.instance.state).toBe('verified');
  });

  it.each([
    ['handler_result', true],
    ['state_readback', false],
  ])('succeeded but %s/verified=%s => completed, NOT verified, limitation stated', (src, ok) => {
    const view = buildWorkflowRecordView({
      record: record('succeeded'),
      lineage: lineage(src, ok),
      sideEffectOf,
    });
    expect(view.instance.state).toBe('completed_unverified');
    expect(view.instance.stateDetail).toContain('not independently verified');
    expect(view.instance.verification.status).toBe('not_independently_verified');
  });

  it('succeeded with NO lineage is never verified', () => {
    const view = buildWorkflowRecordView({
      record: record('succeeded'),
      lineage: [],
      sideEffectOf,
    });
    expect(view.instance.state).toBe('completed_unverified');
    expect(view.steps[0]?.verification.status).toBe('missing');
  });

  it('failed / compensated / partial never read as completed or verified, even with verified lineage', () => {
    const cases: [string, string | undefined, string][] = [
      ['failed', undefined, 'failed'],
      ['failed', 'not_required', 'failed'],
      ['failed', 'compensated', 'compensated'],
      ['compensated', 'compensated', 'compensated'],
      ['failed', 'partial', 'partial'],
      ['failed', 'failed', 'partial'],
    ];
    for (const [status, comp, expected] of cases) {
      const view = buildWorkflowRecordView({
        record: record(status, comp === undefined ? undefined : { status: comp }),
        lineage: lineage('state_readback', true),
        sideEffectOf,
      });
      expect(view.instance.state, `${status}/${comp}`).toBe(expected);
      expect(view.instance.stateDetail.toLowerCase()).not.toContain('completed and');
      expect(view.instance.state).not.toBe('verified');
      expect(view.instance.state).not.toBe('completed_unverified');
    }
  });

  it('in-flight statuses map to the vocabulary', () => {
    const v = {
      status: 'not_applicable',
      limitations: [],
      countedSteps: 0,
      verifiedSteps: 0,
    } as const;
    const s = (status: string, hasApproval = false) =>
      deriveInstanceState({ status, verification: v, hasApproval }).state;
    expect(s('created')).toBe('planned');
    expect(s('ready', true)).toBe('approved');
    expect(s('awaiting_approval')).toBe('waiting_for_approval');
    expect(s('running')).toBe('executing');
    expect(s('cancelled')).toBe('cancelled');
  });

  it('never exposes raw inputs/outputs', () => {
    const view = buildWorkflowRecordView({
      record: record('succeeded'),
      lineage: [],
      sideEffectOf,
    });
    const json = JSON.stringify(view);
    expect(json).not.toContain('RAW-INPUT');
    expect(json).not.toContain('RAW-OUTPUT');
    expect(json).not.toContain('executionKey');
  });

  it('a unit approval maps to waiting / rejected / expired without an instance', () => {
    const base = {
      id: 'apr_1',
      capabilityId: 'workflow.x',
      userId: 'u',
      tenantId: 't',
      createdAt: NOW,
      expiresAt: NOW,
    };
    const state = (status: string) => approvalOnlyView({ ...base, status } as never).state;
    expect(state('awaiting_approval')).toBe('waiting_for_approval');
    expect(state('rejected')).toBe('rejected');
    expect(state('expired')).toBe('expired');
    expect(state('failed')).toBe('failed');
  });
});

interface DonePayload {
  approvals: { id?: string }[];
}

async function client(): Promise<ChatClient> {
  const { app, repos, store } = await buildTestApp({ oidc: new FakeOidcGateway() });
  const session = await login(app);
  const call = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { cookie: session, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { payload: payload as never }),
    });
  return {
    app,
    session,
    store,
    repos,
    get: (p: string) => call('GET', p),
    post: (p: string, b: unknown) => call('POST', p, b),
    postEmpty: (p: string) => call('POST', p, {}),
  } as unknown as ChatClient;
}

async function proposeHire(c: ChatClient, workspaceId: string): Promise<string> {
  const raw = await c.post('/api/ai/chat', {
    message: 'Hire Sarah and assign her to the Mobile Banking project',
    workspaceId,
  });
  const done = parseSse(raw.body as string).find((e) => e.event === 'done')?.data as DonePayload;
  return done.approvals[0]?.id as string;
}

interface ListBody {
  workflows: {
    state: string;
    status: string;
    stateDetail: string;
    verification: { status: string };
  }[];
  composites: { state: string; approvalId: string; capabilityId: string }[];
}

describe('GET /api/workflows read model (REST)', () => {
  it('waiting for approval -> approved+executed (never an instance before approval)', async () => {
    const c = await client();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(c);
    await seedProject(c.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId,
      name: 'Mobile Banking',
      status: 'active',
    });
    const approvalId = await proposeHire(c, workspaceId);

    const pending = (
      await c.get(`/api/workflows?organizationId=${organizationId}`)
    ).json() as ListBody;
    expect(pending.workflows).toHaveLength(0);
    expect(pending.composites).toHaveLength(1);
    expect(pending.composites[0]).toMatchObject({
      state: 'waiting_for_approval',
      approvalId,
      capabilityId: 'workflow.hire_and_assign_employee',
    });

    await c.post(`/api/ai/approvals/${approvalId}/decision`, { decision: 'approve' });
    const after = (
      await c.get(`/api/workflows?organizationId=${organizationId}`)
    ).json() as ListBody;
    expect(after.composites).toHaveLength(0);
    expect(after.workflows).toHaveLength(1);
    // succeeded: verified only if inner verification says so; never a bare "success".
    expect(['verified', 'completed_unverified']).toContain(after.workflows[0]?.state);
    await c.app.close();
  });

  it('rejected approval shows as rejected with nothing run; unresolvable project is compensated, not success', async () => {
    const c = await client();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(c);
    const rejectedId = await proposeHire(c, workspaceId);
    await c.post(`/api/ai/approvals/${rejectedId}/decision`, { decision: 'reject' });
    const rejected = (
      await c.get(`/api/workflows?organizationId=${organizationId}`)
    ).json() as ListBody;
    expect(rejected.composites[0]?.state).toBe('rejected');
    expect(rejected.workflows).toHaveLength(0);

    // No project exists => find_project fails, the hire is rolled back.
    const approvalId = await proposeHire(c, workspaceId);
    await c.post(`/api/ai/approvals/${approvalId}/decision`, { decision: 'approve' });
    const body = (
      await c.get(`/api/workflows?organizationId=${organizationId}`)
    ).json() as ListBody;
    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0]?.state).toBe('compensated');
    expect(body.workflows[0]?.stateDetail).toContain('Rolled back');

    const id = (body.workflows[0] as unknown as { id: string }).id;
    const detail = (
      await c.get(`/api/workflows/${id}?organizationId=${organizationId}`)
    ).json() as { workflow: { steps: { purpose: string; errorCode?: string }[] } };
    expect(detail.workflow.steps.some((s) => s.purpose === 'compensation')).toBe(true);
    expect(JSON.stringify(detail)).not.toContain('"input"');
    await c.app.close();
  });

  it('REST partial failure: create_project succeeded, assignment failed, no compensation => partial', async () => {
    const c = await client();
    const { organizationId } = await onboardOrgAndWorkspace(c);
    const start = await c.post('/api/workflows', {
      organizationId,
      definitionKey: 'projects.create_and_assign_employee',
      input: { projectName: 'Mobile Banking', employeeName: 'Nobody' },
    });
    expect(start.statusCode).toBe(201);
    const wf = (start.json() as { workflow: { instance: { state: string; status: string } } })
      .workflow;
    expect(wf.instance.status).toBe('failed');
    expect(wf.instance.state).toBe('partial');
    await c.app.close();
  });
});
