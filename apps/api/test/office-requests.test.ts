/**
 * Office workflows through the real API with the demo office: every
 * department's requests travel their own chain, only the holder of a seat can
 * take its stage, nobody decides their own request, and people see only the
 * requests they take part in.
 */

import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { demoIds, type DemoIds, type DemoWorkspaceKey } from '../src/demo/world.js';
import { buildTestApp } from './helpers.js';

interface RequestView {
  id: string;
  type: string;
  workflow: string;
  department: string;
  summary: string;
  status: string;
  pending?: { key: string; label: string; kind: string; noteRequired: boolean; noteLabel?: string };
  stages: { key: string; label: string; kind: string; state: string }[];
  requestedByName?: string;
  mine: boolean;
  fields: { label: string; value: string }[];
  history: { action: string; stage?: string; actorName?: string; comment?: string }[];
  actions: { canDecide: boolean; decideBlockedReason?: string; canWithdraw: boolean };
}
type Persona = string;

describe('office workflows — every department on one engine', () => {
  let app: FastifyInstance;
  let ids: DemoIds;
  const cookies = new Map<string, string>();
  /** Where each person sits. */
  const SEAT: Record<Persona, DemoWorkspaceKey> = {
    ceo: 'eng',
    cto: 'tech',
    manager: 'eng',
    dev_aarav: 'eng',
    dev_meghna: 'eng',
    hr: 'hr',
    cfo: 'fin',
    controller: 'fin',
    marketing: 'mkt',
    sales: 'sales',
    support: 'support',
    legal: 'legal',
  };

  async function as(persona: Persona): Promise<string> {
    const cached = cookies.get(persona);
    if (cached !== undefined) return cached;
    const response = await app.inject({
      method: 'POST',
      url: '/api/demo/login',
      headers: { 'content-type': 'application/json' },
      payload: { persona },
    });
    expect(response.statusCode, persona).toBe(200);
    const raw = response.headers['set-cookie'];
    const cookie = ((Array.isArray(raw) ? raw[0] : raw) ?? '').split(';')[0] ?? '';
    cookies.set(persona, cookie);
    return cookie;
  }
  const scope = (workspace: DemoWorkspaceKey) => ({
    organizationId: ids.organizationId,
    workspaceId: ids.workspaceIds[workspace],
  });
  const post = async (
    persona: Persona,
    url: string,
    payload: Record<string, unknown> = {},
    workspace: DemoWorkspaceKey = SEAT[persona] as DemoWorkspaceKey,
  ) =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie: await as(persona), 'content-type': 'application/json' },
      payload: { ...scope(workspace), ...payload },
    });
  const list = async (
    persona: Persona,
    workspace: DemoWorkspaceKey = SEAT[persona] as DemoWorkspaceKey,
  ): Promise<RequestView[]> => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/requests?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds[workspace]}`,
      headers: { cookie: await as(persona) },
    });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { requests: RequestView[] }).requests;
  };
  const viewOf = (response: { json(): unknown }): RequestView =>
    (response.json() as { request: RequestView }).request;
  const raise = async (
    persona: Persona,
    type: string,
    reason: string,
    values: Record<string, unknown>,
    workspace?: DemoWorkspaceKey,
  ): Promise<RequestView> => {
    const response = await post(persona, '/api/requests', { type, reason, values }, workspace);
    expect(response.statusCode, response.body).toBe(201);
    return viewOf(response);
  };
  const take = (
    persona: Persona,
    id: string,
    comment?: string,
    decision: 'approve' | 'reject' = 'approve',
    workspace?: DemoWorkspaceKey,
  ) =>
    post(
      persona,
      `/api/requests/${id}/decision`,
      { decision, ...(comment === undefined ? {} : { comment }) },
      workspace,
    );
  /** Takes the pending stage and expects it to work. */
  const done = async (
    persona: Persona,
    id: string,
    comment?: string,
    workspace?: DemoWorkspaceKey,
  ): Promise<RequestView> => {
    const response = await take(persona, id, comment, 'approve', workspace);
    expect(response.statusCode, `${persona}: ${response.body}`).toBe(200);
    return viewOf(response);
  };

  const LEAVE = { kind: 'vacation', startDate: '2026-11-10', endDate: '2026-11-14' };
  const PURCHASE = { item: 'Test devices', amountMinorUnits: 4_500_000 };
  const ACCESS = { what: 'Production logs (read only)' };

  beforeAll(async () => {
    ({ app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } }));
    ids = demoIds();
    await app.ready();
  });

  it('publishes the catalog: every department, its workflows, their forms and chains', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/requests/catalog?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.eng}`,
      headers: { cookie: await as('dev_aarav') },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      departments: {
        name: string;
        workflows: { key: string; stages: unknown[]; fields: unknown[] }[];
      }[];
      assistant: { connected: boolean };
    };
    expect(body.departments.map((department) => department.name)).toEqual([
      'Leadership',
      'People',
      'Engineering',
      'Marketing',
      'Sales',
      'Customer support',
      'Finance',
      'IT and security',
      'Legal and admin',
    ]);
    for (const department of body.departments) {
      expect(department.workflows.length, department.name).toBeGreaterThan(0);
      for (const workflow of department.workflows) {
        expect(workflow.stages.length, workflow.key).toBeGreaterThan(0);
      }
    }
    // No model is connected in tests, and the catalog says so.
    expect(body.assistant).toEqual({ connected: false });
  });

  it('leave: the developer asks, the team manager approves, then HR — in that order', async () => {
    const raised = await raise('dev_aarav', 'leave', 'Family wedding.', LEAVE);
    expect(raised).toMatchObject({
      workflow: 'Leave',
      department: 'People',
      summary: '10 Nov, 14 Nov, vacation',
      status: 'pending',
      mine: true,
      pending: { key: 'manager', kind: 'decide' },
    });
    expect(raised.stages.map((stage) => `${stage.key}:${stage.state}`)).toEqual([
      'manager:current',
      'hr:waiting',
    ]);
    // HR cannot jump the queue; the requester cannot approve their own leave.
    expect((await take('hr', raised.id)).statusCode).toBe(403);
    expect((await take('dev_aarav', raised.id)).statusCode).toBe(403);

    const managerView = (await list('manager')).find((item) => item.id === raised.id);
    expect(managerView?.actions.canDecide).toBe(true);
    expect(managerView?.requestedByName).toBe('Aarav Kulkarni');
    expect((await done('manager', raised.id)).pending?.key).toBe('hr');
    // The manager cannot also take HR's stage.
    expect((await take('manager', raised.id)).statusCode).toBe(403);
    const finished = await done('hr', raised.id, 'Enjoy the wedding.');
    expect(finished.status).toBe('approved');
    expect(finished.history.map((entry) => `${entry.action}:${entry.actorName}`)).toEqual([
      'submitted:Aarav Kulkarni',
      'approved:Rohan Mehta',
      'approved:Priya Menon',
    ]);
    expect((await take('hr', raised.id)).statusCode).toBe(403);
  });

  it('marketing: a campaign goes to Finance and Legal, is launched, and its results recorded', async () => {
    const raised = await raise('marketing', 'campaign', 'Festive season is our best window.', {
      name: 'Diwali savings offer',
      audience: 'Salaried customers aged 25 to 40',
      goal: '2,000 new accounts',
      budget: 50_000_000,
      launchDate: '2026-10-20',
    });
    expect(raised.summary).toBe('Diwali savings offer, ₹5,00,000');
    // She heads marketing, so the plan's approval is not hers to give…
    expect(raised.stages.map((stage) => `${stage.key}:${stage.state}`)).toEqual([
      'marketing:skipped',
      'finance:current',
      'legal:waiting',
      'launch:waiting',
      'results:waiting',
    ]);
    // …Legal cannot go before Finance, and Sales has no seat in this chain at all.
    expect((await take('legal', raised.id)).statusCode).toBe(403);
    expect((await take('sales', raised.id)).statusCode).toBe(404);
    await done('cfo', raised.id);
    await done('legal', raised.id, 'Remove the word “guaranteed”.');
    // The launch is marketing's own work, and it must be written down.
    expect((await take('marketing', raised.id)).statusCode).toBe(400);
    expect((await take('cfo', raised.id, 'Launched.')).statusCode).toBe(403);
    await done('marketing', raised.id, 'Emails and app banners went out on the 20th.');
    const finished = await done('marketing', raised.id, '2,340 new accounts against 2,000.');
    expect(finished.status).toBe('approved');
    expect(
      finished.stages.every((stage) => stage.state === 'done' || stage.state === 'skipped'),
    ).toBe(true);
  });

  it('support: a customer problem is escalated to engineering and the customer is told', async () => {
    const raised = await raise('support', 'escalation', 'Restarting the app did not help.', {
      customer: 'Rekha Sharma',
      subject: 'Statement download returns an error',
      severity: 'high',
    });
    // The support lead raised it herself: her own confirmation is not needed.
    expect(raised.pending).toMatchObject({ key: 'fix', kind: 'do', noteRequired: true });
    expect((await take('support', raised.id, 'Fixed.')).statusCode).toBe(403);
    await done('cto', raised.id, 'Fixed a timeout in the statement service.');
    const finished = await done('support', raised.id, 'Dear Rekha, the download works again.');
    expect(finished.status).toBe('approved');
  });

  it('sales: a discount needs the sales head and Finance; a contract needs Legal and the CEO', async () => {
    const discount = await raise('sales', 'discount', 'They will sign a three-year deal.', {
      customer: 'Sunrise Retail Pvt Ltd',
      dealValue: 240_000_000,
      discountPercent: 25,
    });
    expect(discount.summary).toBe('Sunrise Retail Pvt Ltd, 25%');
    expect(discount.pending?.key).toBe('finance');
    expect((await done('cfo', discount.id)).status).toBe('approved');

    const contract = await raise('sales', 'contract', 'Three-year platform agreement.', {
      customer: 'Sunrise Retail Pvt Ltd',
      value: 240_000_000,
    });
    expect(contract.pending?.key).toBe('legal');
    await done('legal', contract.id);
    expect((await take('sales', contract.id)).statusCode).toBe(403);
    expect((await done('ceo', contract.id)).status).toBe('approved');
  });

  it('engineering: a bug is confirmed, fixed, and the reporter confirms the fix', async () => {
    const bug = await raise('dev_meghna', 'bug', 'Every Android user on version 4.1.', {
      title: 'Login fails with a valid OTP',
      severity: 'critical',
      steps: 'Enter a valid OTP on Android 15.',
    });
    await done('manager', bug.id);
    await done('cto', bug.id, 'OTP clock skew allowed for.');
    // The last step is the reporter's own: nobody else can take it for her.
    expect((await take('cto', bug.id)).statusCode).toBe(403);
    expect((await done('dev_meghna', bug.id)).status).toBe('approved');
  });

  it('leadership, finance, IT and legal chains reach the right seats', async () => {
    const proposal = await raise('cto', 'project_proposal', 'Competitors launched it last month.', {
      name: 'Instant loan approval',
      customer: 'Small-business owners',
      problem: 'They wait five days for a decision.',
      announcement: 'Lumen now approves small-business loans in ten minutes.',
      cost: 300_000_000,
    });
    expect(proposal.pending?.key).toBe('executive');
    await done('ceo', proposal.id, undefined, 'tech');
    expect((await done('cfo', proposal.id)).status).toBe('approved');

    const purchase = await raise('dev_meghna', 'purchase', 'Needed for the device lab.', PURCHASE);
    await done('manager', purchase.id);
    expect((await take('cto', purchase.id)).statusCode).not.toBe(200);
    expect((await done('cfo', purchase.id)).status).toBe('approved');

    const access = await raise('dev_meghna', 'access', 'On-call starts Monday.', ACCESS);
    await done('manager', access.id);
    expect((await take('cfo', access.id)).statusCode).not.toBe(200);
    expect((await done('cto', access.id)).status).toBe('approved');

    const review = await raise('sales', 'legal_review', 'The liability clause looks one-sided.', {
      document: 'Vendor agreement with CloudNine',
    });
    expect((await take('legal', review.id)).statusCode).toBe(400);
    expect((await done('legal', review.id, 'Cap liability at fees paid.')).status).toBe('approved');
  });

  it('a concern raised with HR is private: the manager never sees it', async () => {
    const concern = await raise('dev_aarav', 'complaint', 'I was asked to work every weekend.', {
      subject: 'Working hours',
    });
    expect((await list('manager')).some((item) => item.id === concern.id)).toBe(false);
    expect((await list('dev_meghna')).some((item) => item.id === concern.id)).toBe(false);
    expect((await list('hr')).find((item) => item.id === concern.id)?.actions.canDecide).toBe(true);
    expect((await take('manager', concern.id, 'Seen.')).statusCode).toBe(404);
  });

  it('saying no needs a reason, ends the request, and the requester sees why', async () => {
    const raised = await raise('dev_aarav', 'purchase', 'Needed for the device lab.', PURCHASE);
    expect((await take('manager', raised.id, undefined, 'reject')).statusCode).toBe(400);
    const rejected = viewOf(await take('manager', raised.id, 'Use the shared devices.', 'reject'));
    expect(rejected.status).toBe('rejected');
    expect(rejected.stages[0]).toMatchObject({ key: 'manager', state: 'returned' });
    const mine = (await list('dev_aarav')).find((item) => item.id === raised.id);
    expect(mine?.history.at(-1)).toMatchObject({
      action: 'rejected',
      comment: 'Use the shared devices.',
    });
  });

  it('a manager’s own request goes to the CEO, not to themselves', async () => {
    const raised = await raise('manager', 'leave', 'Family wedding.', LEAVE);
    expect(raised.pending?.key).toBe('manager');
    expect(raised.actions.canDecide).toBe(false);
    expect((await take('manager', raised.id)).statusCode).toBe(403);
    expect((await done('ceo', raised.id)).pending?.key).toBe('hr');
  });

  it('a decision that would fall to its own requester goes up to the CEO', async () => {
    // Content has ONE decision — the marketing head's — and she wrote it.
    const content = await raise('marketing', 'content', 'For first-time borrowers.', {
      title: 'Five ways to save on EMIs',
      channel: 'blog',
      draft: 'Paying a little extra each month shortens the loan…',
    });
    expect(content.pending?.key).toBe('marketing');
    expect(content.actions.canDecide).toBe(false);
    expect((await take('marketing', content.id)).statusCode).toBe(403);
    // Finance has no say in content.
    expect((await take('cfo', content.id)).statusCode).toBe(404);
    const ceoView = (await list('ceo', 'mkt')).find((item) => item.id === content.id);
    expect(ceoView?.actions.canDecide).toBe(true);
    const approved = await done('ceo', content.id, undefined, 'mkt');
    // Publishing it is her own work again.
    expect(approved.pending?.key).toBe('publish');
    expect((await done('marketing', content.id)).status).toBe('approved');
  });

  it('the executive does NOT get to take a stage whose holder is simply someone else', async () => {
    const raised = await raise('dev_aarav', 'purchase', 'Needed for the device lab.', PURCHASE);
    await done('manager', raised.id);
    // Finance's decision is Finance's — the developer does not hold that seat,
    // so nothing escalates.
    expect((await take('ceo', raised.id)).statusCode).toBe(403);
  });

  it('the manager stage belongs to the request’s own team', async () => {
    const raised = await raise('dev_aarav', 'access', 'On-call starts Monday.', ACCESS);
    expect((await take('cto', raised.id)).statusCode).not.toBe(200);
    expect((await list('cto')).find((item) => item.id === raised.id)?.actions.canDecide).toBe(
      false,
    );
  });

  it('people see only the requests they take part in; a hidden one is "not found"', async () => {
    const raised = await raise('dev_aarav', 'leave', 'Family wedding.', LEAVE);
    expect((await list('dev_meghna')).some((item) => item.id === raised.id)).toBe(false);
    expect((await list('cfo')).some((item) => item.id === raised.id)).toBe(false);
    expect((await list('ceo')).some((item) => item.id === raised.id)).toBe(true);
    expect((await post('dev_meghna', `/api/requests/${raised.id}/withdraw`)).statusCode).toBe(404);
  });

  it('only the requester withdraws, and only while it is pending', async () => {
    const raised = await raise('dev_aarav', 'access', 'On-call starts Monday.', ACCESS);
    expect((await post('manager', `/api/requests/${raised.id}/withdraw`)).statusCode).toBe(403);
    expect(viewOf(await post('dev_aarav', `/api/requests/${raised.id}/withdraw`)).status).toBe(
      'withdrawn',
    );
    expect((await take('manager', raised.id)).statusCode).toBe(403);
    expect((await post('dev_aarav', `/api/requests/${raised.id}/withdraw`)).statusCode).toBe(422);
  });

  it('a value can never smuggle in the workflow, the reason, or fields the form does not have', async () => {
    const raised = await raise('dev_aarav', 'access', 'On-call starts Monday.', {
      ...ACCESS,
      type: 'project_proposal',
      reason: 'overwritten',
      status: 'approved',
      requestedBy: ids.userIds.ceo,
    });
    expect(raised).toMatchObject({ type: 'access', status: 'pending', mine: true });
    expect(raised.pending?.key).toBe('manager');
    expect(JSON.stringify(raised)).not.toContain('overwritten');
  });

  it('refuses invalid requests, a foreign workspace and a missing session', async () => {
    const bad = (values: Record<string, unknown>, type = 'leave') =>
      post('dev_aarav', '/api/requests', { type, reason: 'Family wedding.', values });
    expect((await bad({ ...LEAVE, endDate: '2026-11-01' })).statusCode).toBe(400);
    expect((await bad({ kind: 'vacation' })).statusCode).toBe(400);
    expect((await bad(LEAVE, 'holiday')).statusCode).toBe(400);
    expect(
      (
        await post(
          'dev_aarav',
          '/api/requests',
          { type: 'leave', reason: 'Wedding.', values: LEAVE },
          'fin',
        )
      ).statusCode,
    ).toBe(403);
    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/requests?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.eng}`,
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
