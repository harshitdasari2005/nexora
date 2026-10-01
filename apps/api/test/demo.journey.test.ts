/**
 * The Demo World, exercised through the REAL API: deterministic seed, gated
 * persona sign-in (real sessions), and the two governed journeys the final
 * presentation shows — hire-and-assign (CEO requests, Team Manager approves)
 * and expense submission (Controller submits, CFO approves) — with every
 * assertion read back from persisted backend state.
 */

import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { demoIds, DEMO_HIRE_REQUEST, DEMO_PERSONA_KEYS, type DemoIds } from '../src/demo/world.js';
import { buildTestApp, parseSse } from './helpers.js';

interface Persona {
  cookie: string;
}

async function demoLogin(app: FastifyInstance, persona: string): Promise<Persona> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/demo/login',
    headers: { 'content-type': 'application/json' },
    payload: { persona },
  });
  expect(response.statusCode).toBe(200);
  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = (raw ?? '').split(';')[0] ?? '';
  expect(cookie).toMatch(/^nexora_session=/);
  return { cookie };
}

function call(app: FastifyInstance, who: Persona) {
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: { cookie: who.cookie } }),
    post: (url: string, payload: unknown) =>
      app.inject({
        method: 'POST',
        url,
        headers: { cookie: who.cookie, 'content-type': 'application/json' },
        payload: payload as object,
      }),
  };
}

interface Done {
  status: string;
  approvals: {
    id?: string;
    capabilityId: string;
    status: string;
    requiredApproverRoleId?: string;
    separationOfDuties?: boolean;
  }[];
  steps: { capabilityId: string; status: string }[];
}

async function chat(
  app: FastifyInstance,
  who: Persona,
  message: string,
  workspaceId: string,
  organizationId: string,
) {
  const response = await call(app, who).post('/api/ai/chat', {
    message,
    workspaceId,
    organizationId,
  });
  expect(response.statusCode).toBe(200);
  const events = parseSse(response.body);
  return events.find((event) => event.event === 'done')?.data as Done;
}

describe('Demo World', () => {
  let app: FastifyInstance;
  let ids: DemoIds;

  beforeAll(async () => {
    ({ app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } }));
    ids = demoIds();
    await app.ready();
  });

  it('seeds a deterministic organization with the four personas', async () => {
    const config = await app.inject({ method: 'GET', url: '/api/demo/config' });
    expect(config.statusCode).toBe(200);
    const body = config.json() as {
      seeded: boolean;
      personas: { key: string }[];
      organizationId: string;
    };
    expect(body.seeded).toBe(true);
    expect(body.organizationId).toBe(ids.organizationId);
    expect(body.personas.map((p) => p.key)).toEqual([...DEMO_PERSONA_KEYS]);
    // The public config never reveals user ids or emails.
    expect(JSON.stringify(body)).not.toMatch(/usr_|@lumen-capital/);
  });

  it('signs personas in with REAL sessions whose business roles are resolved, not assigned', async () => {
    const ceo = await demoLogin(app, 'ceo');
    const me = await call(app, ceo).get('/api/me');
    expect(me.statusCode).toBe(200);
    const ctx = await call(app, ceo).get(
      `/api/role-context?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.eng}`,
    );
    expect(ctx.statusCode).toBe(200);
    expect(JSON.stringify(ctx.json())).toContain('executive.ceo');
    const manager = await demoLogin(app, 'manager');
    const managerCtx = await call(app, manager).get(
      `/api/role-context?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.eng}`,
    );
    expect(JSON.stringify(managerCtx.json())).toContain('delivery.manager');
  });

  it('runs the governed hiring journey: CEO requests, cannot self-approve, Team Manager approves', async () => {
    const ceo = await demoLogin(app, 'ceo');
    const done = await chat(app, ceo, DEMO_HIRE_REQUEST, ids.workspaceIds.eng, ids.organizationId);
    expect(done.status).toBe('blocked');
    const approval = done.approvals[0]!;
    expect(approval.capabilityId).toBe('workflow.hire_and_assign_employee');
    expect(approval.requiredApproverRoleId).toBe('delivery.manager');
    expect(approval.separationOfDuties).toBe(true);
    // Nothing exists yet.
    const before = await call(app, ceo).get(`/api/employees?organizationId=${ids.organizationId}`);
    expect(JSON.stringify(before.json())).not.toContain('Sarah Thomas');

    const self = await call(app, ceo).post(`/api/ai/approvals/${approval.id}/decision`, {
      decision: 'approve',
    });
    expect(self.statusCode).toBe(403);

    const manager = await demoLogin(app, 'manager');
    const pending = await call(app, manager).get(
      `/api/approvals/pending?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.eng}`,
    );
    const listed = (pending.json() as { approvals: { id: string; canDecide: boolean }[] })
      .approvals;
    expect(listed.find((a) => a.id === approval.id)?.canDecide).toBe(true);
    const decided = await call(app, manager).post(`/api/ai/approvals/${approval.id}/decision`, {
      decision: 'approve',
    });
    expect(decided.statusCode).toBe(200);

    // The approval's persisted state, as read back by ANY workspace member.
    const read = await call(app, ceo).get(
      `/api/approvals/${approval.id}?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.eng}`,
    );
    expect(read.statusCode).toBe(200);
    expect((read.json() as { approval: Record<string, unknown> }).approval).toMatchObject({
      id: approval.id,
      status: 'completed',
      decision: 'grant',
      decidedById: ids.userIds.manager,
      requesterId: ids.userIds.ceo,
    });
    // A workspace the CEO does not belong to never resolves it.
    const foreign = await call(app, ceo).get(
      `/api/approvals/${approval.id}?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.fin}`,
    );
    expect([403, 404]).toContain(foreign.statusCode);

    const employees = await call(app, manager).get(
      `/api/employees?organizationId=${ids.organizationId}`,
    );
    expect(employees.statusCode).toBe(200);
    expect(JSON.stringify(employees.json())).toContain('Sarah Thomas');

    // The Team Manager sees the employee ↔ project relationship.
    const members = await call(app, manager).get(
      `/api/projects/${ids.projectId}/members?organizationId=${ids.organizationId}`,
    );
    expect(members.statusCode).toBe(200);
    expect(JSON.stringify(members.json())).toContain('Sarah Thomas');
  });

  it('runs the governed finance journey: Controller submits, CFO approves, budget utilization moves', async () => {
    const q = `organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.fin}`;
    const controller = await demoLogin(app, 'controller');
    const budgets = await call(app, controller).get(`/api/finance/budgets?${q}`);
    expect(budgets.statusCode).toBe(200);
    expect((budgets.json() as { budgets: { id: string }[] }).budgets.map((b) => b.id)).toContain(
      ids.budgetId,
    );
    const utilBefore = await call(app, controller).get(`/api/finance/budgets/utilization?${q}`);
    const before = (
      utilBefore.json() as {
        utilization: { budgetId: string; spentMinorUnits?: number; utilizationPercent?: number }[];
      }
    ).utilization;

    const done = await chat(
      app,
      controller,
      `Submit an expense of 45,000 INR for Mobile device test lab licences against budget ${ids.budgetId}`,
      ids.workspaceIds.fin,
      ids.organizationId,
    );
    expect(done.status).toBe('blocked');
    const approval = done.approvals[0]!;
    expect(approval.capabilityId).toBe('finance.submit_expense');
    expect(approval.requiredApproverRoleId).toBe('finance.cfo');
    expect(approval.separationOfDuties).toBe(true);

    // The submitter cannot approve their own submission.
    const self = await call(app, controller).post(`/api/ai/approvals/${approval.id}/decision`, {
      decision: 'approve',
    });
    expect(self.statusCode).toBe(403);
    // A user without the required role (the Team Manager — also not a member of
    // the Finance workspace) cannot either: with no standing in the approval's
    // workspace it is reported exactly like a missing approval (F-008).
    const manager = await demoLogin(app, 'manager');
    const wrong = await call(app, manager).post(`/api/ai/approvals/${approval.id}/decision`, {
      decision: 'approve',
    });
    expect(wrong.statusCode).toBe(404);

    const cfo = await demoLogin(app, 'cfo');
    const decided = await call(app, cfo).post(`/api/ai/approvals/${approval.id}/decision`, {
      decision: 'approve',
    });
    expect(decided.statusCode).toBe(200);

    // The submission created a PENDING expense (real finance state).
    const listed = await call(app, cfo).get(`/api/finance/expenses?${q}`);
    const expenses = (
      listed.json() as {
        expenses: { id: string; status: string; description: string; submittedBy: string }[];
      }
    ).expenses;
    const created = expenses.find((e) => e.description.includes('test lab'));
    expect(created?.status).toBe('pending');
    expect(created?.submittedBy).toBe(ids.userIds.controller);

    // The submitter still cannot decide the expense; the CFO can.
    const selfDecide = await call(app, controller).post(
      `/api/finance/expenses/${created!.id}/decide`,
      {
        organizationId: ids.organizationId,
        workspaceId: ids.workspaceIds.fin,
        decision: 'approve',
      },
    );
    expect(selfDecide.statusCode).toBeGreaterThanOrEqual(400);
    const cfoDecide = await call(app, cfo).post(`/api/finance/expenses/${created!.id}/decide`, {
      organizationId: ids.organizationId,
      workspaceId: ids.workspaceIds.fin,
      decision: 'approve',
    });
    expect(cfoDecide.statusCode).toBe(200);

    const after = (
      (await call(app, cfo).get(`/api/finance/budgets/utilization?${q}`)).json() as {
        utilization: { budgetId: string; spentMinorUnits?: number; utilizationPercent?: number }[];
      }
    ).utilization;
    const budgetBefore = before.find((entry) => entry.budgetId === ids.budgetId);
    const budgetAfter = after.find((entry) => entry.budgetId === ids.budgetId);
    // Utilization counts APPROVED expenses only: 4,000,000 (seeded) + 4,500,000 (approved live).
    expect(budgetBefore).toMatchObject({ spentMinorUnits: 4_000_000, utilizationPercent: 20 });
    expect(budgetAfter).toMatchObject({ spentMinorUnits: 8_500_000, utilizationPercent: 43 });
  });

  it('projects the finance decisions into the Audit Center for the audit-capable persona', async () => {
    const ceo = await demoLogin(app, 'ceo');
    const response = await call(app, ceo).get(
      `/api/audit/events?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.eng}&source=activity`,
    );
    expect(response.statusCode).toBe(200);
    const events = (
      response.json() as {
        events: { source: string; action: string; detail?: string; actorId?: string }[];
      }
    ).events;
    const submitted = events.find((e) => e.action === 'Expense submitted');
    const approved = events.find((e) => e.action === 'Expense approved');
    // Attributed to the trusted human actors — never invented.
    expect(submitted).toMatchObject({ actorId: ids.userIds.controller });
    expect(submitted?.detail).toContain('INR 45,000.00');
    expect(approved).toMatchObject({ actorId: ids.userIds.cfo });
  });

  it('rejects a persona key outside the allowlist and any client-supplied identity', async () => {
    for (const payload of [
      { persona: 'admin' },
      { persona: 'ceo', email: 'anika.rao@lumen-capital.example' },
      { persona: 'ceo', userId: ids.userIds.ceo },
      { email: 'anika.rao@lumen-capital.example' },
      {},
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/demo/login',
        headers: { 'content-type': 'application/json' },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('refuses reset to a caller that is not a demo persona, and without a session', async () => {
    const anonymous = await app.inject({ method: 'POST', url: '/api/demo/reset' });
    expect(anonymous.statusCode).toBe(401);
    // With in-memory repositories there is no database: reset is unavailable, never faked.
    const ceo = await demoLogin(app, 'ceo');
    const reset = await call(app, ceo).post('/api/demo/reset', {});
    expect(reset.statusCode).toBe(501);
    // Any attempt to pick a target is a schema error.
    const targeted = await call(app, ceo).post('/api/demo/reset', { organizationId: 'org_other' });
    expect(targeted.statusCode).toBe(400);
  });
});

describe('Demo mode disabled', () => {
  it('does not expose any demo route and leaves normal authentication unchanged', async () => {
    const { app } = await buildTestApp();
    for (const [method, url] of [
      ['GET', '/api/demo/config'],
      ['POST', '/api/demo/login'],
      ['POST', '/api/demo/reset'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        payload: method === 'POST' ? { persona: 'ceo' } : undefined,
      });
      expect(response.statusCode).toBe(404);
    }
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/me' });
    expect(unauthenticated.statusCode).toBe(401);
  });
});
