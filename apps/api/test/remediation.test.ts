/**
 * Phase 10 — governed remediation console API tests (`fastify.inject`).
 *
 * The HTTP surface over the GENERIC remediation engine (`POST
 * /api/problems/:problemId/plans`, `POST /api/plans/:planId/advance`,
 * `POST /api/plans/:planId/replan`, `POST /api/plans/:planId/cancel`,
 * `GET /api/plans`, `GET /api/plans/:planId`). Covers:
 * - the happy path: an APPLICABLE known solution → a dynamic, validated plan
 *   whose step executes through the EXISTING governed execution path (real
 *   tool, verified, journaled with plan linkage)
 * - when the step verified but the condition persists, the plan re-plans
 *   (bounded) — never loops silently
 * - fail closed: a plan whose solution requires a capability outside the
 *   caller's agent set is BLOCKED with an explicit reason — never a partial
 *   plan, never an escalation
 * - honest no-solution: no applicable knowledge → NO_SOLUTION, never invented
 * - security: unauthenticated access is 401 everywhere; forged plan ids
 *   resolve to 404/409; foreign workspaces resolve to 403 — never a leak
 *
 * The happy path uses the `workflow_degradation` signal: its remediation
 * vocabulary is the single read-only capability `notifications.what_needs_attention`
 * (in the Executive agent's executable set, parameterless tool) so the
 * step executes deterministically through the real orchestrator.
 */

import { describe, expect, it } from 'vitest';
import type { BusinessProblemDto } from '@nexora/contracts/detection';
import type { RemediationPlanDto } from '@nexora/contracts/remediation';
import type { TenantId, UserId } from '@nexora/contracts/common';
import { Notification } from '@nexora/module-notifications';
import { nowIso } from '@nexora/shared/time';

import {
  buildTestApp,
  chatClient,
  currentUserId,
  login,
  onboardOrgAndWorkspace,
  seedProject,
  type ChatClient,
} from './helpers.js';
import { FakeAgentExecutionRecorder } from './fakes.js';

/** Creates + publishes a knowledge article through the real API path. */
async function createAndPublishArticle(
  client: ChatClient,
  scope: { organizationId: string; workspaceId: string },
  article: { title: string; body: string },
): Promise<string> {
  const created = await client.post('/api/knowledge/articles', {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    title: article.title,
    body: article.body,
  });
  expect([200, 201]).toContain(created.statusCode);
  const articleId = (created.json() as { article: { id: string } }).article.id;
  const published = await client.post(`/api/knowledge/articles/${articleId}/publish`, {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });
  expect(published.statusCode).toBe(200);
  return articleId;
}

/**
 * Builds a logged-in client with a custom execution journal (so the Phase 10
 * plan linkage columns can be asserted directly).
 */
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
    postEmpty(path) {
      return app.inject({
        method: 'POST',
        url: path,
        headers: { cookie: session, 'content-type': 'application/json' },
        payload: {},
      });
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
  };
}

/** Seeds a tenant measurement snapshot with a failing workflow (real state). */
function seedFailingWorkflowMeasurements(client: ChatClient, organizationId: string): void {
  (
    client.repos.measurements as unknown as {
      seed: (
        t: TenantId,
        s: {
          tenantId: string;
          generatedAt: string;
          workflowHealth: unknown[];
          onboarding: unknown[];
          auditCompleteness: unknown;
          overview: {
            users: number;
            workspaces: number;
            projects: number;
            documents: number;
            knowledgeSources: number;
            calendarEvents: number;
          };
        },
      ) => void;
    }
  ).seed(organizationId as TenantId, {
    tenantId: organizationId,
    generatedAt: '2026-08-15T00:00:00.000Z',
    workflowHealth: [
      {
        definitionKey: 'employee-onboarding',
        total: 4,
        succeeded: 3,
        failed: 1,
        successRate: 75,
        unrecoverableErrorRate: 25,
        cycleTimeP50Ms: 12_000,
        cycleTimeP95Ms: 40_000,
      },
    ],
    onboarding: [],
    auditCompleteness: {
      traceableShare: 100,
      totalEvents: 0,
      tracedEvents: 0,
      untracedTypes: [],
    },
    overview: {
      users: 1,
      workspaces: 1,
      projects: 0,
      documents: 0,
      knowledgeSources: 0,
      calendarEvents: 0,
    },
  });
}

/** Seeds a tenant snapshot with a DEGRADING workflow (no hard failures). */
function seedDegradingWorkflowMeasurements(client: ChatClient, organizationId: string): void {
  (
    client.repos.measurements as unknown as {
      seed: (
        t: TenantId,
        s: {
          tenantId: string;
          generatedAt: string;
          workflowHealth: unknown[];
          onboarding: unknown[];
          auditCompleteness: unknown;
          overview: {
            users: number;
            workspaces: number;
            projects: number;
            documents: number;
            knowledgeSources: number;
            calendarEvents: number;
          };
        },
      ) => void;
    }
  ).seed(organizationId as TenantId, {
    tenantId: organizationId,
    generatedAt: '2026-08-15T00:00:00.000Z',
    workflowHealth: [
      {
        definitionKey: 'employee-onboarding',
        total: 4,
        succeeded: 3,
        failed: 0,
        successRate: 90,
        unrecoverableErrorRate: 0,
        cycleTimeP50Ms: 12_000,
        cycleTimeP95Ms: 40_000,
      },
    ],
    onboarding: [],
    auditCompleteness: {
      traceableShare: 100,
      totalEvents: 0,
      tracedEvents: 0,
      untracedTypes: [],
    },
    overview: {
      users: 1,
      workspaces: 1,
      projects: 0,
      documents: 0,
      knowledgeSources: 0,
      calendarEvents: 0,
    },
  });
}

describe('Phase 10 remediation — plan creation', () => {
  it('rejects unauthenticated access with 401 (all six console routes)', async () => {
    const { app } = await buildTestApp();
    const list = await app.inject({ method: 'GET', url: '/api/plans' });
    expect(list.statusCode).toBe(401);
    const getOne = await app.inject({ method: 'GET', url: '/api/plans/rpl_any' });
    expect(getOne.statusCode).toBe(401);
    const advance = await app.inject({ method: 'POST', url: '/api/plans/rpl_any/advance' });
    expect(advance.statusCode).toBe(401);
    const replan = await app.inject({ method: 'POST', url: '/api/plans/rpl_any/replan' });
    expect(replan.statusCode).toBe(401);
    const cancel = await app.inject({ method: 'POST', url: '/api/plans/rpl_any/cancel' });
    expect(cancel.statusCode).toBe(401);
    const create = await app.inject({
      method: 'POST',
      url: '/api/problems/prb_any/plans',
      payload: {},
    });
    expect(create.statusCode).toBe(401);
  });

  it('A — an applicable known solution produces a dynamic, validated plan', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    seedDegradingWorkflowMeasurements(client, organizationId);
    // EXISTING KNOWLEDGE FIRST: the runbook concerns the affected entity.
    await createAndPublishArticle(
      client,
      { organizationId, workspaceId },
      {
        title: 'AUTH-017 Authentication correction',
        body: 'When the employee-onboarding workflow degrades, correct the authentication configuration.',
      },
    );

    const scanned = await client.postEmpty(
      `/api/problems/scan?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(scanned.statusCode).toBe(200);
    const problem = (scanned.json() as { problems: BusinessProblemDto[] }).problems.find(
      (p) => p.signalId === 'workflow_degradation',
    );
    expect(problem).toBeDefined();
    expect(problem?.remediationCapabilities).toEqual(['notifications.what_needs_attention']);
    const applicable = problem?.solutions.find((s) => s.applicability === 'APPLICABLE');
    expect(applicable).toBeDefined();

    const created = await client.post(
      `/api/problems/${problem?.id ?? ''}/plans?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    expect(created.statusCode).toBe(200);
    const plan = (created.json() as { plan: RemediationPlanDto }).plan;
    // The single required capability is read-only + in the Executive set →
    // the plan is validated and READY (no approval gate).
    expect(plan.status).toBe('READY');
    expect(plan.agentId).toBe('executive');
    expect(plan.roleId).toBe('executive.ceo');
    expect(plan.groundedSolutionId).toBe(applicable?.id);
    expect(plan.problemId).toBe(problem?.id);
    expect(plan.steps.map((step) => step.capabilityId)).toEqual([
      'notifications.what_needs_attention',
    ]);
    expect(plan.steps[0]?.approvalRequirement).toBe('NONE');
    expect(plan.steps[0]?.status).toBe('PENDING');

    // The problem lifecycle moved: a validated plan → REMEDIATION_PLANNED.
    const after = await client.get(
      `/api/problems/${problem?.id ?? ''}?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    const problemAfter = (after.json() as { problem: BusinessProblemDto }).problem;
    expect(problemAfter.status).toBe('REMEDIATION_PLANNED');
  });

  it('B — no applicable known solution → NO_SOLUTION, never fabricated', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    seedFailingWorkflowMeasurements(client, organizationId);

    // No knowledge exists → the workflow_failure problem has no solution.
    const scanned = await client.postEmpty(
      `/api/problems/scan?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    const problem = (scanned.json() as { problems: BusinessProblemDto[] }).problems.find(
      (p) => p.signalId === 'workflow_failure',
    );
    expect(problem?.recommendation?.summary).toContain('No known solution found');

    const created = await client.post(
      `/api/problems/${problem?.id ?? ''}/plans?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    expect(created.statusCode).toBe(409);
    expect((created.json() as { error: { code: string } }).error.code).toBe('NO_SOLUTION');
  });

  it('C — a solution requiring a capability outside the agent set → the plan is BLOCKED, never executable', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    seedFailingWorkflowMeasurements(client, organizationId);

    // The workflow_failure signal's remediation vocabulary includes
    // workflow.retry_run — NOT in the Executive agent's registered set.
    await createAndPublishArticle(
      client,
      { organizationId, workspaceId },
      {
        title: 'AUTH-017 Authentication correction',
        body: 'When the employee-onboarding workflow fails, correct the authentication configuration.',
      },
    );

    const scanned = await client.postEmpty(
      `/api/problems/scan?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    const problem = (scanned.json() as { problems: BusinessProblemDto[] }).problems.find(
      (p) => p.signalId === 'workflow_failure',
    );
    expect(problem?.solutions.some((s) => s.applicability === 'APPLICABLE')).toBe(true);

    const created = await client.post(
      `/api/problems/${problem?.id ?? ''}/plans?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    expect(created.statusCode).toBe(200);
    const plan = (created.json() as { plan: RemediationPlanDto }).plan;
    // The plan EXISTS but is BLOCKED with an explicit reason — no partial
    // plan missing part of the known solution, never an escalation.
    expect(plan.status).toBe('BLOCKED');
    expect(plan.reason).toContain('outside');
    expect(plan.steps).toEqual([]);
    // The problem lifecycle reflects the block (owned by the plan engine).
    const after = await client.get(
      `/api/problems/${problem?.id ?? ''}?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect((after.json() as { problem: BusinessProblemDto }).problem.status).toBe(
      'REMEDIATION_BLOCKED',
    );
  });

  it('a forged problem id resolves to 404 — never a plan for someone else', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const created = await client.post(
      `/api/problems/prb_forged/plans?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    expect(created.statusCode).toBe(404);
    expect((created.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});

describe('Phase 10 remediation — stepwise execution', () => {
  /** Detects a workflow_degradation problem with an applicable runbook. */
  async function setupDegradationProblem(): Promise<{
    client: ChatClient;
    organizationId: string;
    workspaceId: string;
    problemId: string;
  }> {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    seedDegradingWorkflowMeasurements(client, organizationId);
    await createAndPublishArticle(
      client,
      { organizationId, workspaceId },
      {
        title: 'AUTH-017 Authentication correction',
        body: 'When the employee-onboarding workflow degrades, correct the authentication configuration.',
      },
    );
    const scanned = await client.postEmpty(
      `/api/problems/scan?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    const problem = (scanned.json() as { problems: BusinessProblemDto[] }).problems.find(
      (p) => p.signalId === 'workflow_degradation',
    );
    expect(problem).toBeDefined();
    return { client, organizationId, workspaceId, problemId: problem?.id ?? '' };
  }

  it('executes the plan step through the EXISTING governed path (verified + journaled)', async () => {
    const recorder = new FakeAgentExecutionRecorder();
    const client = await chatClientWithRecorder(recorder);
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    seedDegradingWorkflowMeasurements(client, organizationId);
    await createAndPublishArticle(
      client,
      { organizationId, workspaceId },
      {
        title: 'AUTH-017 Authentication correction',
        body: 'When the employee-onboarding workflow degrades, correct the authentication configuration.',
      },
    );
    const scanned = await client.postEmpty(
      `/api/problems/scan?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    const problem = (scanned.json() as { problems: BusinessProblemDto[] }).problems.find(
      (p) => p.signalId === 'workflow_degradation',
    );
    expect(problem).toBeDefined();
    const problemId = problem?.id ?? '';
    const created = await client.post(
      `/api/problems/${problemId}/plans?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    const planId = (created.json() as { plan: RemediationPlanDto }).plan.id;

    // The step executes through the REAL orchestrator → ToolExecutor with
    // the capability bound to the step — verified.
    const advanced = await client.post(
      `/api/plans/${planId}/advance?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    expect(advanced.statusCode).toBe(200);
    const body = advanced.json() as {
      plan: RemediationPlanDto;
      stepId: string;
      outcome: {
        status: string;
        steps: { capabilityId: string; status: string; verified: boolean }[];
      };
    };
    expect(body.outcome.status).toBe('completed');
    expect(body.outcome.steps[0]?.capabilityId).toBe('notifications.what_needs_attention');
    expect(body.outcome.steps[0]?.status).toBe('succeeded');
    expect(body.outcome.steps[0]?.verified).toBe(true);
    expect(body.stepId).toBeDefined();

    // The execution journal carries the plan linkage (problem → plan → step).
    expect(recorder.records.some((r) => r.planId === planId && r.problemId === problemId)).toBe(
      true,
    );
    expect(recorder.records.some((r) => r.stepId !== undefined)).toBe(true);

    // The plan console resolves the plan with its problem + steps. The
    // advance re-planned (the condition persists after the verified step),
    // so the plan is a fresh executable version with a runnable step.
    const resolved = await client.get(
      `/api/plans/${planId}?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(resolved.statusCode).toBe(200);
    const plan = (resolved.json() as { plan: RemediationPlanDto }).plan;
    expect(plan.id).toBe(planId);
    expect(plan.problem.id).toBe(problemId);
    expect(plan.version).toBe(2);
    expect(plan.steps.some((step) => step.status === 'PENDING')).toBe(true);

    // The list surface shows the scope's plans.
    const listed = await client.get(
      `/api/plans?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(listed.statusCode).toBe(200);
    expect(
      (listed.json() as { plans: RemediationPlanDto[] }).plans.some((p) => p.id === planId),
    ).toBe(true);
  });

  it('when the step verified but the condition persists, the plan re-plans (bounded) — never loops silently', async () => {
    const { client, organizationId, workspaceId, problemId } = await setupDegradationProblem();
    const created = await client.post(
      `/api/problems/${problemId}/plans?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    const planId = (created.json() as { plan: RemediationPlanDto }).plan.id;

    // The step executes and verifies, but the condition (degraded workflow
    // measurements) persists → the plan re-plans into a NEW version.
    const advanced = await client.post(
      `/api/plans/${planId}/advance?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    expect(advanced.statusCode).toBe(200);
    const plan = (advanced.json() as { plan: RemediationPlanDto }).plan;
    expect(plan.version).toBe(2);
    expect(plan.replanCount).toBe(1);
    // Fresh steps — the plan is executable again, never stuck.
    expect(plan.steps[0]?.status).toBe('PENDING');
    expect(['READY', 'AWAITING_APPROVAL']).toContain(plan.status);
  });

  it('cancel stops remediation without claiming the problem resolved', async () => {
    const { client, organizationId, workspaceId, problemId } = await setupDegradationProblem();
    const created = await client.post(
      `/api/problems/${problemId}/plans?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    const planId = (created.json() as { plan: RemediationPlanDto }).plan.id;

    const cancelled = await client.post(
      `/api/plans/${planId}/cancel?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    expect(cancelled.statusCode).toBe(200);
    const plan = (cancelled.json() as { plan: RemediationPlanDto }).plan;
    expect(plan.status).toBe('CANCELLED');

    // The problem stays open — marked blocked (remediation stopped), never
    // RESOLVED by cancellation.
    const after = await client.get(
      `/api/problems/${problemId}?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect((after.json() as { problem: BusinessProblemDto }).problem.status).toBe(
      'REMEDIATION_BLOCKED',
    );
  });

  it('M — forged/foreign plan ids fail closed on every surface', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const getOne = await client.get(
      `/api/plans/rpl_forged?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(getOne.statusCode).toBe(404);
    const advance = await client.post(
      `/api/plans/rpl_forged/advance?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    expect(advance.statusCode).toBe(409);
    const replan = await client.post(
      `/api/plans/rpl_forged/replan?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    expect(replan.statusCode).toBe(404);
    const cancel = await client.post(
      `/api/plans/rpl_forged/cancel?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      {},
    );
    expect(cancel.statusCode).toBe(404);
  });

  it('a foreign workspace resolves to 403 on every route — never a leak', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    await client.repos.workspaces.save(
      (await import('@nexora/domain-workspaces')).Workspace.hydrate({
        id: 'wsp_alien',
        organizationId,
        slug: 'alien-ws',
        name: 'Alien workspace',
        type: 'project',
        visibility: 'private',
        status: 'active',
        settings: {},
        branding: {},
        preferences: {},
        features: [],
        agentBindings: [],
        knowledgeBindings: [],
        workflowBindings: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      } as never),
    );
    const foreign = `organizationId=${organizationId}&workspaceId=wsp_alien`;
    expect((await client.get(`/api/plans?${foreign}`)).statusCode).toBe(403);
    expect((await client.postEmpty(`/api/plans/rpl_any/advance?${foreign}`)).statusCode).toBe(403);
    expect((await client.postEmpty(`/api/plans/rpl_any/replan?${foreign}`)).statusCode).toBe(403);
    expect((await client.postEmpty(`/api/plans/rpl_any/cancel?${foreign}`)).statusCode).toBe(403);
    expect((await client.postEmpty(`/api/problems/prb_any/plans?${foreign}`)).statusCode).toBe(403);
  });
});

describe('Phase 10 remediation — end-to-end resolution (approval gate + real fix)', () => {
  it(
    'project_attention: investigate → known solution → plan → approve → ' +
      'execute → verify → RESOLVED, through a real state-changing capability',
    async () => {
      const client = await chatClient();
      const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
      const userId = currentUserId(client);

      // Real persisted state: an active project + an unread notification for
      // the caller — exactly the `project_attention` condition.
      await seedProject(client.repos, {
        id: 'prj_attn',
        organizationId,
        name: 'Mobile Banking',
        status: 'active',
      });
      await client.repos.notifications.save(
        Notification.create(
          {
            recipientId: userId as UserId,
            tenantId: organizationId as TenantId,
            workspaceId: workspaceId as never,
            type: 'project.decision_needed',
            category: 'project',
            title: 'Decision needed on Mobile Banking',
            body: 'The release plan needs your sign-off.',
            priority: 'normal',
            sourceEventId: 'evt_decision_1',
            correlationId: 'corr_decision_1',
          },
          nowIso(),
        ),
      );

      // The knowledge base already documents the fix — discovered, never
      // invented (same "existing knowledge first" path as every other case).
      await createAndPublishArticle(
        client,
        { organizationId, workspaceId },
        {
          title: 'Attention backlog runbook',
          body: 'When project attention items pile up, check what needs attention and clear it.',
        },
      );

      const scanned = await client.postEmpty(
        `/api/problems/scan?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      );
      const problem = (scanned.json() as { problems: BusinessProblemDto[] }).problems.find(
        (p) => p.signalId === 'project_attention',
      );
      expect(problem).toBeDefined();
      const problemId = problem?.id ?? '';
      const applicable = problem?.solutions.find((s) => s.applicability === 'APPLICABLE');
      expect(applicable).toBeDefined();

      const created = await client.post(
        `/api/problems/${problemId}/plans?organizationId=${organizationId}&workspaceId=${workspaceId}`,
        {},
      );
      expect(created.statusCode).toBe(200);
      const planId = (created.json() as { plan: RemediationPlanDto }).plan.id;

      // Step 1 (read-only, no approval): what-needs-attention — executes
      // immediately; the condition still holds afterward.
      const step1 = await client.postEmpty(
        `/api/plans/${planId}/advance?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      );
      expect(step1.statusCode).toBe(200);
      const afterStep1 = (step1.json() as { plan: RemediationPlanDto }).plan;
      expect(afterStep1.status).not.toBe('COMPLETED');

      // Step 2 (consequential — always requires approval, BR-13): the
      // engine opens ONE approval and waits; it does not execute yet.
      const step2 = await client.postEmpty(
        `/api/plans/${planId}/advance?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      );
      expect(step2.statusCode).toBe(200);
      const awaiting = (step2.json() as { plan: RemediationPlanDto }).plan;
      expect(awaiting.status).toBe('AWAITING_APPROVAL');
      const pendingStep = awaiting.steps.find((s) => s.status === 'AWAITING_APPROVAL');
      expect(pendingStep?.capabilityId).toBe('notifications.mark_all_read');
      const approvalId = pendingStep?.approvalId;
      expect(approvalId).toBeDefined();

      // Approve through the EXISTING chat approval surface (the same
      // decision endpoint every other governed write uses).
      const decision = await client.post(`/api/ai/approvals/${approvalId}/decision`, {
        decision: 'approve',
      });
      expect(decision.statusCode).toBe(200);

      // Pull the authoritative result through the SAME governed advance
      // call — the plan engine executes the now-approved step, re-evaluates
      // the problem, and finds the condition genuinely gone (no unread
      // notifications left): the plan COMPLETES and the problem RESOLVES.
      const finalAdvance = await client.postEmpty(
        `/api/plans/${planId}/advance?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      );
      expect(finalAdvance.statusCode).toBe(200);
      const finalPlan = (finalAdvance.json() as { plan: RemediationPlanDto }).plan;
      expect(finalPlan.status).toBe('COMPLETED');
      expect(finalPlan.outcome?.status).toBe('resolved');
      expect(finalPlan.problem.status).toBe('RESOLVED');

      const problemAfter = await client.get(
        `/api/problems/${problemId}?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      );
      expect((problemAfter.json() as { problem: BusinessProblemDto }).problem.status).toBe(
        'RESOLVED',
      );
    },
  );
});
