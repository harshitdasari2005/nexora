/**
 * Tenant-isolation audit F-001 — business problems are scoped by tenant AND
 * workspace (attack-path tests through the real HTTP + detection + remediation
 * stack).
 *
 * The caller is a member of TWO workspaces of one organization. A problem that
 * belongs to workspace A must be invisible and immutable when the caller names
 * workspace B in scope, even though the problem id is real and the tenant
 * matches: read, re-evaluation, transition (via the plan lifecycle) and plan
 * creation all resolve exactly like a missing id (404), leak nothing, and
 * mutate nothing. The owning workspace is the positive control.
 */

import { describe, expect, it } from 'vitest';
import type { BusinessProblemDto } from '@nexora/contracts/detection';
import type { RemediationPlanDto } from '@nexora/contracts/remediation';
import type { TenantId } from '@nexora/contracts/common';

import {
  chatClient,
  chatClientWithSecondUser,
  onboardOrgAndWorkspace,
  seedOrganization,
  seedWorkspace,
  type ChatClient,
} from './helpers.js';

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

const ARTICLE = {
  title: 'AUTH-017 Authentication correction',
  body: 'When the employee-onboarding workflow degrades, correct the authentication configuration.',
};

async function twoWorkspaceCaller() {
  const client = await chatClient();
  const { organizationId, workspaceId: workspaceA } = await onboardOrgAndWorkspace(client);
  // A second workspace created through the real API (the caller is its owner).
  const createdB = await client.post('/api/workspaces', {
    organizationId,
    name: 'Operations',
    slug: 'operations',
    type: 'engineering',
  });
  expect(createdB.statusCode).toBe(201);
  const workspaceB = (createdB.json().workspace as { id: string }).id;
  seedDegradingWorkflowMeasurements(client, organizationId);
  // The SAME knowledge exists in both workspaces, so a plan could legitimately
  // be built in either: a 404 below can only come from the problem scope.
  await createAndPublishArticle(client, { organizationId, workspaceId: workspaceA }, ARTICLE);
  await createAndPublishArticle(client, { organizationId, workspaceId: workspaceB }, ARTICLE);
  const q = (workspaceId: string) => `organizationId=${organizationId}&workspaceId=${workspaceId}`;
  const scan = async (workspaceId: string): Promise<BusinessProblemDto> => {
    const response = await client.postEmpty(`/api/problems/scan?${q(workspaceId)}`);
    expect(response.statusCode).toBe(200);
    const problem = (response.json() as { problems: BusinessProblemDto[] }).problems.find(
      (p) => p.signalId === 'workflow_degradation',
    );
    expect(problem).toBeDefined();
    return problem as BusinessProblemDto;
  };
  const problemA = await scan(workspaceA);
  const problemB = await scan(workspaceB);
  expect(problemA.id).not.toBe(problemB.id);
  return { client, organizationId, workspaceA, workspaceB, problemA, problemB, q };
}

describe('F-001 — problems are tenant + workspace scoped', () => {
  it('GET /api/problems/:id: a foreign workspace gets 404 with no problem data; the owner and the other workspace get their own', async () => {
    const { client, workspaceA, workspaceB, problemA, problemB, q } = await twoWorkspaceCaller();

    const foreign = await client.get(`/api/problems/${problemA.id}?${q(workspaceB)}`);
    expect(foreign.statusCode).toBe(404);
    // Identical to a missing id — no leak, no existence oracle.
    const missing = await client.get(`/api/problems/prb_does_not_exist?${q(workspaceB)}`);
    expect(missing.statusCode).toBe(404);
    expect(foreign.json()).toEqual({
      error: {
        ...(foreign.json() as { error: Record<string, unknown> }).error,
        requestId: expect.any(String),
      },
    });
    expect(JSON.stringify(foreign.json())).not.toContain(problemA.title);

    // Controls: each workspace resolves its own problem.
    const own = await client.get(`/api/problems/${problemA.id}?${q(workspaceA)}`);
    expect(own.statusCode).toBe(200);
    expect((own.json() as { problem: BusinessProblemDto }).problem.workspaceId).toBe(workspaceA);
    const ownB = await client.get(`/api/problems/${problemB.id}?${q(workspaceB)}`);
    expect(ownB.statusCode).toBe(200);
    expect((ownB.json() as { problem: BusinessProblemDto }).problem.workspaceId).toBe(workspaceB);
  });

  it('GET /api/problems lists only the named workspace’s problems', async () => {
    const { client, workspaceA, workspaceB, problemA, problemB, q } = await twoWorkspaceCaller();
    const ids = async (workspaceId: string) =>
      (
        (await client.get(`/api/problems?${q(workspaceId)}`)).json() as {
          problems: { id: string }[];
        }
      ).problems.map((p) => p.id);
    expect(await ids(workspaceA)).toEqual(expect.arrayContaining([problemA.id]));
    expect(await ids(workspaceA)).not.toContain(problemB.id);
    expect(await ids(workspaceB)).not.toContain(problemA.id);
  });

  it('POST /api/problems/:id/plans: a plan cannot be created in workspace B from workspace A’s problem, and nothing changes', async () => {
    const { client, workspaceA, workspaceB, problemA, q } = await twoWorkspaceCaller();

    const attempt = await client.post(`/api/problems/${problemA.id}/plans?${q(workspaceB)}`, {});
    expect(attempt.statusCode).toBe(404);

    // No plan was created in either workspace.
    for (const ws of [workspaceA, workspaceB]) {
      const plans = (await client.get(`/api/plans?${q(ws)}`)).json() as {
        plans: RemediationPlanDto[];
      };
      expect(plans.plans).toEqual([]);
    }
    // The problem is untouched (still DETECTED, no plan link).
    const after = await client.get(`/api/problems/${problemA.id}?${q(workspaceA)}`);
    expect((after.json() as { problem: BusinessProblemDto }).problem.status).toBe('DETECTED');

    // Control: the owning workspace can plan its own problem.
    const ok = await client.post(`/api/problems/${problemA.id}/plans?${q(workspaceA)}`, {});
    expect([200, 201]).toContain(ok.statusCode);
    const plan = (ok.json() as { plan: RemediationPlanDto }).plan;
    expect(plan.workspaceId).toBe(workspaceA);
  });

  it('a plan in workspace A cannot be used to transition a problem it does not own (plan lifecycle stays in scope)', async () => {
    const { client, workspaceA, workspaceB, problemA, problemB, q } = await twoWorkspaceCaller();
    const created = await client.post(`/api/problems/${problemA.id}/plans?${q(workspaceA)}`, {});
    const planId = (created.json() as { plan: RemediationPlanDto }).plan.id;

    // Workspace B cannot cancel A's plan (and so cannot move A's problem)…
    expect(
      (await client.postEmpty(`/api/plans/${planId}/cancel?${q(workspaceB)}`)).statusCode,
    ).toBe(404);
    const stillA = await client.get(`/api/problems/${problemA.id}?${q(workspaceA)}`);
    expect((stillA.json() as { problem: BusinessProblemDto }).problem.status).not.toBe('RESOLVED');
    // …and B's own problem is unaffected by anything done to A's.
    const stillB = await client.get(`/api/problems/${problemB.id}?${q(workspaceB)}`);
    expect((stillB.json() as { problem: BusinessProblemDto }).problem.status).toBe('DETECTED');
  });
});

/**
 * The stronger attacker: a user who is a member of W1 ONLY (never of W2) and who
 * already knows the id of a W2 problem. The tests hand them the real id, so the
 * boundary is proven independently of whether the id is discoverable.
 */
async function singleWorkspaceAttacker() {
  const owner = await chatClientWithSecondUser();
  const { organizationId, workspaceId: w1 } = await onboardOrgAndWorkspace(owner);
  const createdW2 = await owner.post('/api/workspaces', {
    organizationId,
    name: 'Operations',
    slug: 'operations',
    type: 'engineering',
  });
  expect(createdW2.statusCode).toBe(201);
  const w2 = (createdW2.json().workspace as { id: string }).id;
  seedDegradingWorkflowMeasurements(owner, organizationId);
  // The same knowledge in both workspaces: a refusal can only come from the problem scope.
  await createAndPublishArticle(owner, { organizationId, workspaceId: w1 }, ARTICLE);
  await createAndPublishArticle(owner, { organizationId, workspaceId: w2 }, ARTICLE);
  const q = (workspaceId: string) => `organizationId=${organizationId}&workspaceId=${workspaceId}`;
  const scan = async (workspaceId: string): Promise<BusinessProblemDto> => {
    const response = await owner.postEmpty(`/api/problems/scan?${q(workspaceId)}`);
    expect(response.statusCode).toBe(200);
    const problem = (response.json() as { problems: BusinessProblemDto[] }).problems.find(
      (p) => p.signalId === 'workflow_degradation',
    );
    expect(problem).toBeDefined();
    return problem as BusinessProblemDto;
  };
  const w1Problem = await scan(w1);
  const w2Problem = await scan(w2);
  expect(w1Problem.id).not.toBe(w2Problem.id);
  // The attacker joins W1 only.
  await owner.second.join({ organizationId, workspaceId: w1, workspaceRole: 'owner' });
  /** The error of a response without its per-request id (for equivalence checks). */
  const errorOf = (response: { json(): unknown }) => {
    const { code, message } = (response.json() as { error: { code: string; message: string } })
      .error;
    return { code, message };
  };
  /**
   * The PERSISTED record of the W2 problem as its owner reads it. Evidence ids
   * are regenerated by every read-time investigation, so they are not compared.
   */
  const persisted = async () => {
    const response = await owner.get(`/api/problems/${w2Problem.id}?${q(w2)}`);
    expect(response.statusCode).toBe(200);
    const p = (response.json() as { problem: BusinessProblemDto }).problem;
    return {
      id: p.id,
      correlationId: p.correlationId,
      workspaceId: p.workspaceId,
      title: p.title,
      description: p.description,
      severity: p.severity,
      status: p.status,
      detectedAt: p.detectedAt,
      updatedAt: p.updatedAt,
      affectedEntities: p.affectedEntities,
    };
  };
  return {
    owner,
    attacker: owner.second,
    organizationId,
    w1,
    w2,
    w1Problem,
    w2Problem,
    q,
    errorOf,
    persisted,
  };
}

describe('F-001 — a member of ONE workspace cannot reach another workspace’s problem by id', () => {
  it('GET: the W2 problem id answers exactly like a forged id, leaks nothing, and mutates nothing', async () => {
    const f = await singleWorkspaceAttacker();
    const before = await f.persisted();

    const foreign = await f.attacker.get(`/api/problems/${f.w2Problem.id}?${f.q(f.w1)}`);
    const forged = await f.attacker.get(`/api/problems/prb_does_not_exist?${f.q(f.w1)}`);
    expect(foreign.statusCode).toBe(404);
    expect(forged.statusCode).toBe(404);
    // Same code and message as a non-existent id: no existence oracle.
    expect(f.errorOf(foreign)).toEqual(f.errorOf(forged));
    expect(foreign.body).not.toContain(f.w2Problem.title);
    expect(foreign.body).not.toContain(f.w2Problem.description);
    expect(foreign.body).not.toContain(f.w2Problem.id);

    // Naming W2 directly is refused too (the attacker is not a member of it).
    const direct = await f.attacker.get(`/api/problems/${f.w2Problem.id}?${f.q(f.w2)}`);
    expect([403, 404]).toContain(direct.statusCode);
    expect(direct.body).not.toContain(f.w2Problem.title);

    // The problem is exactly as the owner last saw it.
    const after = await f.persisted();
    expect(after).toEqual(before);
  });

  it('POST plans: no plan can be created from the W2 problem; the answer equals a forged id; nothing is created or changed', async () => {
    const f = await singleWorkspaceAttacker();
    const before = await f.persisted();

    const foreign = await f.attacker.post(`/api/problems/${f.w2Problem.id}/plans?${f.q(f.w1)}`, {});
    const forged = await f.attacker.post(`/api/problems/prb_does_not_exist/plans?${f.q(f.w1)}`, {});
    expect(foreign.statusCode).toBe(404);
    expect(forged.statusCode).toBe(404);
    expect(f.errorOf(foreign)).toEqual(f.errorOf(forged));
    expect(foreign.body).not.toContain(f.w2Problem.title);
    expect(foreign.body).not.toContain(f.w2Problem.id);

    // No plan exists in either workspace, and the W2 problem is untouched.
    for (const workspace of [f.w1, f.w2]) {
      const plans = (await f.owner.get(`/api/plans?${f.q(workspace)}`)).json() as {
        plans: RemediationPlanDto[];
      };
      expect(plans.plans).toEqual([]);
    }
    const after = await f.persisted();
    expect(after).toEqual(before);
    expect(after.status).toBe('DETECTED');
  });

  it('legitimate access still works: the W1 member reads and plans W1’s problem; the W2 member reads W2’s', async () => {
    const f = await singleWorkspaceAttacker();
    const own = await f.attacker.get(`/api/problems/${f.w1Problem.id}?${f.q(f.w1)}`);
    expect(own.statusCode).toBe(200);
    expect((own.json() as { problem: BusinessProblemDto }).problem).toMatchObject({
      id: f.w1Problem.id,
      workspaceId: f.w1,
    });
    const planned = await f.attacker.post(`/api/problems/${f.w1Problem.id}/plans?${f.q(f.w1)}`, {});
    expect([200, 201]).toContain(planned.statusCode);
    expect((planned.json() as { plan: RemediationPlanDto }).plan.workspaceId).toBe(f.w1);

    const ownW2 = await f.owner.get(`/api/problems/${f.w2Problem.id}?${f.q(f.w2)}`);
    expect(ownW2.statusCode).toBe(200);
    expect((ownW2.json() as { problem: BusinessProblemDto }).problem).toMatchObject({
      id: f.w2Problem.id,
      workspaceId: f.w2,
    });
  });

  it('another ORGANIZATION cannot read or plan the problem, with the same answer as a forged id', async () => {
    const f = await singleWorkspaceAttacker();
    await seedOrganization(f.owner.repos, { id: 'org_f001_b', slug: 'f001-b' });
    await seedWorkspace(f.owner.repos, {
      id: 'wsp_f001_b',
      organizationId: 'org_f001_b',
      slug: 'f001-b-ws',
    });
    await f.attacker.join({
      organizationId: 'org_f001_b',
      workspaceId: 'wsp_f001_b',
      workspaceRole: 'owner',
    });
    const orgB = 'organizationId=org_f001_b&workspaceId=wsp_f001_b';
    const before = await f.persisted();

    for (const problem of [f.w1Problem, f.w2Problem]) {
      const read = await f.attacker.get(`/api/problems/${problem.id}?${orgB}`);
      const forged = await f.attacker.get(`/api/problems/prb_does_not_exist?${orgB}`);
      expect(read.statusCode).toBe(404);
      expect(f.errorOf(read)).toEqual(f.errorOf(forged));
      expect(read.body).not.toContain(problem.title);
      const plan = await f.attacker.post(`/api/problems/${problem.id}/plans?${orgB}`, {});
      expect(plan.statusCode).toBe(404);
    }
    const plansB = (await f.attacker.get(`/api/plans?${orgB}`)).json() as { plans: unknown[] };
    expect(plansB.plans).toEqual([]);
    const after = await f.persisted();
    expect(after).toEqual(before);
  });

  it('a forged problem id is a plain 404 for read and plan creation, for every caller', async () => {
    const f = await singleWorkspaceAttacker();
    for (const [caller, workspace] of [
      [f.attacker, f.w1],
      [f.owner, f.w1],
      [f.owner, f.w2],
    ] as const) {
      const read = await caller.get(`/api/problems/prb_forged?${f.q(workspace)}`);
      expect(read.statusCode).toBe(404);
      expect((read.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
      const plan = await caller.post(`/api/problems/prb_forged/plans?${f.q(workspace)}`, {});
      expect(plan.statusCode).toBe(404);
    }
  });
});
