/**
 * The demo office: every person can sign in and resolves to their own business
 * role; the CEO sees every department and can raise any request there, but
 * approvals still belong to the role that owns them (Finance decides money).
 * Exercised through the real API with real sessions.
 */

import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { demoIds, DEMO_PERSONAS, type DemoIds } from '../src/demo/world.js';
import { buildTestApp, parseSse } from './helpers.js';

async function signIn(app: FastifyInstance, persona: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/demo/login',
    headers: { 'content-type': 'application/json' },
    payload: { persona },
  });
  expect(response.statusCode, persona).toBe(200);
  const setCookie = response.headers['set-cookie'];
  return ((Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '').split(';')[0] ?? '';
}

describe('demo office roles', () => {
  let app: FastifyInstance;
  let ids: DemoIds;
  const get = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { cookie } });
  const post = (cookie: string, url: string, payload: object) =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie, 'content-type': 'application/json' },
      payload,
    });
  const roleIn = async (cookie: string, workspaceId: string) => {
    const response = await get(
      cookie,
      `/api/role-context?organizationId=${ids.organizationId}&workspaceId=${workspaceId}`,
    );
    return (response.json() as { current?: { roleId?: string; workspaceId?: string } }).current;
  };

  beforeAll(async () => {
    ({ app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } }));
    ids = demoIds();
    await app.ready();
  });

  it('has the whole office: CEO, CTO, Team Manager, two developers, HR, CFO, Controller', () => {
    expect(DEMO_PERSONAS.map((persona) => persona.title)).toEqual([
      'Chief Executive Officer',
      'Chief Technology Officer',
      'Team Manager',
      'Software Developer',
      'Software Developer',
      'HR Manager',
      'Chief Financial Officer',
      'Finance Controller',
    ]);
  });

  it('every person signs in and resolves to their own role in their own workspace', async () => {
    for (const persona of DEMO_PERSONAS) {
      const cookie = await signIn(app, persona.key);
      const current = await roleIn(cookie, ids.workspaceIds[persona.workspace]);
      expect(current?.roleId, persona.key).toBe(persona.expectedRoleId);
      expect(current?.workspaceId, persona.key).toBe(ids.workspaceIds[persona.workspace]);
    }
  });

  it('the CEO is the CEO in EVERY department — never the CFO, the HR manager or the CTO', async () => {
    const ceo = await signIn(app, 'ceo');
    for (const workspace of ['eng', 'tech', 'hr', 'fin'] as const) {
      expect((await roleIn(ceo, ids.workspaceIds[workspace]))?.roleId, workspace).toBe(
        'executive.ceo',
      );
    }
  });

  it('the CEO sees every department', async () => {
    const ceo = await signIn(app, 'ceo');
    const org = `organizationId=${ids.organizationId}`;
    const fin = `${org}&workspaceId=${ids.workspaceIds.fin}`;
    for (const url of [
      `/api/finance/budgets?${fin}`,
      `/api/finance/expenses?${fin}`,
      `/api/finance/budgets/utilization?${fin}`,
      `/api/employees?${org}`,
      `/api/projects?${org}`,
      `/api/dashboard?${org}&workspaceId=${ids.workspaceIds.hr}`,
      `/api/dashboard?${org}&workspaceId=${ids.workspaceIds.tech}`,
      `/api/audit/events?${org}&workspaceId=${ids.workspaceIds.eng}`,
    ]) {
      expect((await get(ceo, url)).statusCode, url).toBe(200);
    }
  });

  it('the CEO can RAISE an expense in Finance, but only Finance decides it', async () => {
    const ceo = await signIn(app, 'ceo');
    const chat = await post(ceo, '/api/ai/chat', {
      message: `Submit an expense of 12,000 INR for Leadership offsite venue against budget ${ids.budgetId}`,
      workspaceId: ids.workspaceIds.fin,
      organizationId: ids.organizationId,
    });
    expect(chat.statusCode).toBe(200);
    const done = parseSse(chat.body).find((event) => event.event === 'done')?.data as {
      status: string;
      approvals: { id?: string; capabilityId: string; requiredApproverRoleId?: string }[];
    };
    expect(done.status).toBe('blocked'); // raised, waiting for an approver
    const approval = done.approvals[0]!;
    expect(approval.capabilityId).toBe('finance.submit_expense');
    expect(approval.requiredApproverRoleId).toBe('finance.cfo');

    // The CEO cannot approve their own request — and is not the CFO in Finance.
    const self = await post(ceo, `/api/ai/approvals/${approval.id}/decision`, {
      decision: 'approve',
    });
    expect(self.statusCode).toBe(403);

    // Finance approves the submission → a PENDING expense submitted by the CEO.
    const cfo = await signIn(app, 'cfo');
    expect(
      (await post(cfo, `/api/ai/approvals/${approval.id}/decision`, { decision: 'approve' }))
        .statusCode,
    ).toBe(200);
    const q = `organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.fin}`;
    const expense = (
      (await get(cfo, `/api/finance/expenses?${q}`)).json() as {
        expenses: { id: string; status: string; description: string; submittedBy: string }[];
      }
    ).expenses.find((entry) => entry.description.includes('offsite'));
    expect(expense).toMatchObject({ status: 'pending', submittedBy: ids.userIds.ceo });

    // Deciding the expense is Finance's job: the CEO holds no `expenses.decide`.
    const body = {
      organizationId: ids.organizationId,
      workspaceId: ids.workspaceIds.fin,
      decision: 'approve',
    };
    expect((await post(ceo, `/api/finance/expenses/${expense!.id}/decide`, body)).statusCode).toBe(
      403,
    );
    expect((await post(cfo, `/api/finance/expenses/${expense!.id}/decide`, body)).statusCode).toBe(
      200,
    );
  });

  it("the CEO cannot approve someone ELSE's finance request either (wrong approver role)", async () => {
    const controller = await signIn(app, 'controller');
    const chat = await post(controller, '/api/ai/chat', {
      message: `Submit an expense of 9,000 INR for Team lunch against budget ${ids.budgetId}`,
      workspaceId: ids.workspaceIds.fin,
      organizationId: ids.organizationId,
    });
    const done = parseSse(chat.body).find((event) => event.event === 'done')?.data as {
      approvals: { id?: string }[];
    };
    const ceo = await signIn(app, 'ceo');
    const attempt = await post(ceo, `/api/ai/approvals/${done.approvals[0]!.id}/decision`, {
      decision: 'approve',
    });
    expect(attempt.statusCode).toBe(403);
  });

  it('other people stay inside their own departments', async () => {
    const org = `organizationId=${ids.organizationId}`;
    const developer = await signIn(app, 'dev_aarav');
    const hr = await signIn(app, 'hr');
    const cto = await signIn(app, 'cto');
    const finance = `/api/finance/expenses?${org}&workspaceId=${ids.workspaceIds.fin}`;
    for (const cookie of [developer, hr, cto]) {
      expect((await get(cookie, finance)).statusCode).toBe(403);
    }
    // Each of them can still open their own workspace.
    expect(
      (await get(hr, `/api/dashboard?${org}&workspaceId=${ids.workspaceIds.hr}`)).statusCode,
    ).toBe(200);
    expect(
      (await get(cto, `/api/dashboard?${org}&workspaceId=${ids.workspaceIds.tech}`)).statusCode,
    ).toBe(200);
    expect((await get(developer, `/api/projects?${org}`)).statusCode).toBe(200);
  });

  it('HR works with employee records from the HR workspace; nobody borrows that seat', async () => {
    const org = `organizationId=${ids.organizationId}`;
    const hr = await signIn(app, 'hr');
    const developer = await signIn(app, 'dev_aarav');
    const cfo = await signIn(app, 'cfo');
    const fromHr = `/api/employees?${org}&workspaceId=${ids.workspaceIds.hr}`;

    // HR reads the employee list from the HR workspace, and keeps records there.
    const listed = await get(hr, fromHr);
    expect(listed.statusCode, listed.body).toBe(200);
    expect((listed.json() as { employees: unknown[] }).employees.length).toBeGreaterThan(0);
    const created = await post(hr, '/api/employees', {
      organizationId: ids.organizationId,
      workspaceId: ids.workspaceIds.hr,
      name: 'Nisha Verma',
    });
    expect(created.statusCode, created.body).toBe(201);

    // Naming the HR workspace does not help someone who is not a member of it…
    for (const cookie of [developer, cfo]) {
      expect((await get(cookie, fromHr)).statusCode).toBe(403);
      const attempt = await post(cookie, '/api/employees', {
        organizationId: ids.organizationId,
        workspaceId: ids.workspaceIds.hr,
        name: 'Should Not Exist',
      });
      expect(attempt.statusCode).toBe(403);
    }
    // …and their own seats do not carry the permission.
    expect(
      (await get(developer, `/api/employees?${org}&workspaceId=${ids.workspaceIds.eng}`))
        .statusCode,
    ).toBe(403);
    expect(
      (await get(cfo, `/api/employees?${org}&workspaceId=${ids.workspaceIds.fin}`)).statusCode,
    ).toBe(403);
    const names = (
      (await get(hr, fromHr)).json() as { employees: { name: string }[] }
    ).employees.map((employee) => employee.name);
    expect(names).toContain('Nisha Verma');
    expect(names).not.toContain('Should Not Exist');
  });
});
