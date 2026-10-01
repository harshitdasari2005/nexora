/**
 * The decision trace of a workflow-related event (`wfs:` / a composite `apr:`)
 * tells the WHOLE story: the instance state (same derivation as the workflow
 * read model), the step + compensation timeline, and — for a composite unit
 * approval — who authorized it versus who executed. Read models over records
 * written when things happened: no historical execution record is rewritten,
 * and an executed step is never re-labelled as failed.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { buildBaseWorld } from '@nexora/evaluation';

import { createScenarioApp, type ScenarioApp } from '../evaluation/harness.js';

const AUTHORITY = 'POLICY_APPROVAL_AUTHORITY';
const COMPENSATED_HIRE = 'Hire Rohan Das and assign him to the Quantum Ledger project';
const SUCCEEDED_HIRE = 'Hire Sarah Thomas and assign her to the Mobile Banking Platform project';

interface WfStep {
  stepId: string;
  toolId: string;
  name: string;
  purpose: 'step' | 'compensation';
  compensatesStepId?: string;
  status: string;
  executedAt?: string;
  errorCode?: string;
  laterState?: string;
  compensatedBy?: string;
}

interface Trace {
  actors: {
    requester: { userId: string };
    approver?: { userId: string };
    executor: { kind: string; userId: string; agentId?: string };
    executionAuthority: string;
  };
  approval?: { id: string; decidedBy?: string };
  executions: {
    toolId?: string;
    status?: string;
    origin?: string;
    approvalId?: string;
    matchesApprovedInput?: boolean;
    workflow?: { stepId?: string; purpose?: string };
    compositeApproval?: {
      approvalId: string;
      approvalScope: string;
      approvedBy?: string;
      role: string;
    };
    laterState?: string;
    compensatedBy?: string;
  }[];
  workflow?: {
    instanceId: string;
    state: string;
    rollbackSummary: string;
    steps: WfStep[];
    note: string;
  };
  attribution?: {
    approvalScope: string;
    approvalId: string;
    approvedBy?: string;
    innerExecutionAuthority: string;
    approverExecutedSteps: boolean;
    innerExecutionCount: number;
    statement: string;
  };
}

describe('workflow decision trace', () => {
  let app: ScenarioApp | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function setup(sod = true) {
    app = await createScenarioApp(buildBaseWorld());
    const orgId = app.world.organization('aurora').id;
    const wsId = app.world.workspace('aurora-eng').id;
    const meera = app.world.user('meera').id;
    const vikram = app.world.user('vikram').id;
    if (sod) {
      await app.repos.policySettings!.append({
        organizationId: orgId,
        policyId: AUTHORITY,
        config: { rules: [{ capabilityPrefix: 'workflow.', separationOfDuties: true }] },
        createdBy: meera,
      });
    }
    return { app, orgId, wsId, meera, vikram };
  }

  const scope = (orgId: string, wsId: string) => `organizationId=${orgId}&workspaceId=${wsId}`;

  /** A chat composite, approved by `approver`; returns the unit approval id. */
  async function runHire(
    ctx: Awaited<ReturnType<typeof setup>>,
    message: string,
    approver = 'vikram',
  ): Promise<string> {
    const chat = await ctx.app.request('meera', 'POST', '/api/ai/chat', {
      message,
      organizationId: ctx.orgId,
      workspaceId: ctx.wsId,
    });
    const approvalId = /"id":"(apr_[^"]+)"/.exec(chat.body)?.[1] as string;
    expect(approvalId).toBeTruthy();
    const decided = await ctx.app.request(
      approver,
      'POST',
      `/api/ai/approvals/${approvalId}/decision`,
      { decision: 'approve' },
    );
    expect(decided.statusCode).toBe(200);
    return approvalId;
  }

  async function traceOf(
    ctx: Awaited<ReturnType<typeof setup>>,
    eventId: string,
    user = 'meera',
  ): Promise<Trace> {
    const response = await ctx.app.request(
      user,
      'GET',
      `/api/audit/events/${eventId}/trace?${scope(ctx.orgId, ctx.wsId)}`,
    );
    expect(response.statusCode).toBe(200);
    return (response.json() as { trace: Trace }).trace;
  }

  async function firstStepEvent(ctx: Awaited<ReturnType<typeof setup>>): Promise<string> {
    const listed = await ctx.app.request(
      'meera',
      'GET',
      `/api/audit/events?${scope(ctx.orgId, ctx.wsId)}&limit=500&source=workflow_step`,
    );
    const ids = (listed.json() as { events: { id: string }[] }).events.map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    return ids[0] as string;
  }

  it('a compensated hire: step executed, later step failed, compensation executed, final state COMPENSATED — no executed step re-labelled failed', async () => {
    const ctx = await setup();
    const approvalId = await runHire(ctx, COMPENSATED_HIRE);
    for (const eventId of [`apr:${approvalId}`, await firstStepEvent(ctx)]) {
      const trace = await traceOf(ctx, eventId);
      const wf = trace.workflow;
      expect(wf?.state).toBe('compensated');
      expect(wf?.rollbackSummary).toContain('Rolled back');
      const byId = new Map(wf?.steps.map((s) => [s.stepId, s]));
      // Step A executed successfully — its OWN status is untouched — and was later compensated.
      expect(byId.get('hire_employee')).toMatchObject({
        purpose: 'step',
        status: 'succeeded',
        laterState: 'compensated',
        compensatedBy: 'compensate:hire_employee',
      });
      expect(byId.get('find_project')).toMatchObject({ status: 'succeeded' });
      // Step B is the one that truly failed.
      expect(byId.get('assign_employee')?.status).toBe('failed');
      // The compensation is its own recorded step.
      expect(byId.get('compensate:hire_employee')).toMatchObject({
        purpose: 'compensation',
        compensatesStepId: 'hire_employee',
        status: 'succeeded',
      });
      // No forward step that SUCCEEDED is reported failed; only the genuinely failed step is.
      expect(wf?.steps.filter((s) => s.status === 'failed').map((s) => s.stepId)).toEqual([
        'assign_employee',
      ]);
      expect(wf?.note).toContain('compensation executed for');
      expect(wf?.note).toContain('Final workflow state: COMPENSATED.');
      // The execution rows keep their own status and carry the later-state reference.
      const hire = trace.executions.find((x) => x.toolId === 'hr.create_employee');
      expect(hire).toMatchObject({
        status: 'succeeded',
        laterState: 'compensated',
        compensatedBy: 'compensate:hire_employee',
      });
      const revoke = trace.executions.find((x) => x.toolId === 'hr.revoke_hire');
      expect(revoke).toMatchObject({ status: 'succeeded', workflow: { purpose: 'compensation' } });
      expect(revoke?.laterState).toBeUndefined();
      // Sanitized: ids / statuses only — never the raw inputs.
      expect(JSON.stringify(trace.workflow)).not.toContain('Rohan');
    }
  });

  it('a partial workflow: the executed step is left behind (not_rolled_back), state PARTIAL, never completed', async () => {
    const ctx = await setup(false);
    const started = await ctx.app.request('meera', 'POST', '/api/workflows', {
      organizationId: ctx.orgId,
      definitionKey: 'projects.create_and_assign_employee',
      input: { projectName: 'Mobile Banking', employeeName: 'Nobody' },
    });
    expect(started.statusCode).toBe(201);
    const workflow = (started.json() as { workflow: { steps: { id: string; stepId: string }[] } })
      .workflow;
    const trace = await traceOf(ctx, `wfs:${workflow.steps[0]?.id}`);
    expect(trace.workflow?.state).toBe('partial');
    const executed = trace.workflow?.steps.filter((s) => s.status === 'succeeded') ?? [];
    expect(executed.length).toBeGreaterThan(0);
    // The state-changing step that ran is flagged as left behind; its status stays 'succeeded'.
    expect(executed.some((s) => s.laterState === 'not_rolled_back')).toBe(true);
    expect(
      executed.every((s) => s.laterState === undefined || s.laterState === 'not_rolled_back'),
    ).toBe(true);
    expect(trace.workflow?.steps.some((s) => s.purpose === 'compensation')).toBe(false);
    expect(trace.workflow?.rollbackSummary).toContain('NOT rolled back');
    expect(trace.workflow?.note).toContain('Final workflow state: PARTIAL.');
    // A REST-started workflow has no composite approval: no attribution block.
    expect(trace.attribution).toBeUndefined();
  });

  it('a succeeded composite: the trace is unchanged in substance (all steps executed, no later state, never COMPENSATED)', async () => {
    const ctx = await setup();
    const approvalId = await runHire(ctx, SUCCEEDED_HIRE);
    const trace = await traceOf(ctx, `apr:${approvalId}`);
    expect(['verified', 'completed_unverified']).toContain(trace.workflow?.state);
    expect(trace.workflow?.steps.every((s) => s.status === 'succeeded')).toBe(true);
    expect(trace.workflow?.steps.some((s) => s.purpose === 'compensation')).toBe(false);
    expect(trace.workflow?.steps.some((s) => s.laterState !== undefined)).toBe(false);
    expect(trace.workflow?.rollbackSummary).toBe('');
    expect(trace.workflow?.note).not.toContain('compensation');
    expect(trace.executions.some((x) => x.laterState !== undefined)).toBe(false);
    expect(trace.executions.filter((x) => x.workflow !== undefined).length).toBeGreaterThan(0);
  });

  it('composite approval: it authorized the composite, the approver executed nothing, requester ≠ approver, executor = requester', async () => {
    const ctx = await setup();
    const approvalId = await runHire(ctx, SUCCEEDED_HIRE);
    const trace = await traceOf(ctx, `apr:${approvalId}`);

    expect(trace.attribution).toMatchObject({
      approvalScope: 'composite_workflow',
      approvalId,
      approvedBy: ctx.vikram,
      innerExecutionAuthority: 'workflow_instance_under_requester_ceiling',
      approverExecutedSteps: false,
    });
    expect(trace.attribution?.innerExecutionCount).toBeGreaterThan(0);
    expect(trace.attribution?.statement).toContain('authorized the composite workflow');
    expect(trace.attribution?.statement).toContain('the approver did not execute any step');

    // Actors: requester ≠ approver; the executor is the requester — never the approver.
    expect(trace.actors.requester.userId).toBe(ctx.meera);
    expect(trace.actors.approver?.userId).toBe(ctx.vikram);
    expect(trace.actors.executor).toEqual({ kind: 'user', userId: ctx.meera });
    expect(trace.actors.executionAuthority).toBe('requester_rbac');
    expect(trace.actors.approver?.userId).not.toBe(trace.actors.executor.userId);

    // Every inner execution references the UNIT approval (as the authority that authorized the composite).
    const inner = trace.executions.filter((x) => x.workflow !== undefined);
    expect(inner.length).toBe(trace.attribution?.innerExecutionCount);
    for (const execution of inner) {
      expect(execution.approvalId).toBe(approvalId);
      expect(execution.compositeApproval).toEqual({
        approvalId,
        approvalScope: 'composite_workflow',
        approvedBy: ctx.vikram,
        role: 'authorized_the_composite',
      });
      // An inner step is never "input mismatched" against the unit approval.
      expect(execution.matchesApprovedInput).toBeUndefined();
    }
    // The outer composite execution is compared to the approved input (and matches).
    const outer = trace.executions.find((x) => x.workflow === undefined && x.origin !== undefined);
    expect(outer?.toolId).toBe('workflow.hire_and_assign_employee');
    expect(outer?.matchesApprovedInput).toBe(true);
    expect(outer?.compositeApproval).toBeUndefined();
    // Control: a non-composite approval trace has no attribution block.
    const chat = await ctx.app.request('meera', 'POST', '/api/ai/chat', {
      message: 'Create a calendar event titled Attribution Control tomorrow at 9am',
      organizationId: ctx.orgId,
      workspaceId: ctx.wsId,
    });
    const other = /"id":"(apr_[^"]+)"/.exec(chat.body)?.[1] as string;
    expect(other).toBeTruthy();
    const plain = await traceOf(ctx, `apr:${other}`);
    expect(plain.attribution).toBeUndefined();
    expect(plain.workflow).toBeUndefined();
  });

  it('a foreign tenant gets 404 for both the workflow step and the unit approval (control: the owner reads them)', async () => {
    const ctx = await setup();
    const approvalId = await runHire(ctx, COMPENSATED_HIRE);
    const stepEvent = await firstStepEvent(ctx);
    const foreignScope = scope(
      ctx.app.world.organization('borealis').id,
      ctx.app.world.workspace('borealis-hq').id,
    );
    for (const eventId of [`apr:${approvalId}`, stepEvent]) {
      expect((await traceOf(ctx, eventId)).workflow).toBeDefined();
      const foreign = await ctx.app.request(
        'lena',
        'GET',
        `/api/audit/events/${eventId}/trace?${foreignScope}`,
      );
      expect(foreign.statusCode).toBe(404);
      expect(foreign.body).not.toContain('compensated');
      expect(foreign.body).not.toContain('hire_employee');
    }
  });
});
