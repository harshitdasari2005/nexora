/**
 * Office requests through the real API with the demo office: each kind of
 * request travels its own chain, only the right person can take each stage,
 * nobody decides their own request, and people see only the requests they
 * take part in.
 */

import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { demoIds, type DemoIds, type DemoWorkspaceKey } from '../src/demo/world.js';
import { buildTestApp } from './helpers.js';

interface RequestView {
  id: string;
  type: string;
  status: string;
  pendingStage?: string;
  stages: { stage: string; state: string }[];
  requestedByName?: string;
  mine: boolean;
  history: { action: string; stage?: string; actorName?: string; comment?: string }[];
  actions: { canDecide: boolean; decideBlockedReason?: string; canWithdraw: boolean };
}

describe('office requests — leave, purchase and IT access', () => {
  let app: FastifyInstance;
  let ids: DemoIds;
  const cookies = new Map<string, string>();

  async function as(persona: string): Promise<string> {
    const cached = cookies.get(persona);
    if (cached !== undefined) return cached;
    const response = await app.inject({
      method: 'POST',
      url: '/api/demo/login',
      headers: { 'content-type': 'application/json' },
      payload: { persona },
    });
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
    persona: string,
    workspace: DemoWorkspaceKey,
    url: string,
    payload: Record<string, unknown> = {},
  ) =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie: await as(persona), 'content-type': 'application/json' },
      payload: { ...scope(workspace), ...payload },
    });
  const list = async (persona: string, workspace: DemoWorkspaceKey): Promise<RequestView[]> => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/requests?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds[workspace]}`,
      headers: { cookie: await as(persona) },
    });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { requests: RequestView[] }).requests;
  };
  const raise = async (
    persona: string,
    workspace: DemoWorkspaceKey,
    payload: Record<string, unknown>,
  ): Promise<RequestView> => {
    const response = await post(persona, workspace, '/api/requests', payload);
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { request: RequestView }).request;
  };
  const decide = (
    persona: string,
    workspace: DemoWorkspaceKey,
    id: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ) =>
    post(persona, workspace, `/api/requests/${id}/decision`, {
      decision,
      ...(comment === undefined ? {} : { comment }),
    });
  const viewOf = (response: { json(): unknown }): RequestView =>
    (response.json() as { request: RequestView }).request;

  const LEAVE = {
    type: 'leave',
    kind: 'vacation',
    startDate: '2026-11-10',
    endDate: '2026-11-14',
    reason: 'Family wedding.',
  };
  const PURCHASE = {
    type: 'purchase',
    item: 'Test devices',
    amountMinorUnits: 4_500_000,
    currency: 'INR',
    reason: 'Needed for the device lab.',
  };
  const ACCESS = {
    type: 'access',
    what: 'Production logs (read only)',
    reason: 'On-call rotation starts Monday.',
  };

  beforeAll(async () => {
    ({ app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } }));
    ids = demoIds();
    await app.ready();
  });

  it('leave: the developer asks, the team manager approves, then HR — in that order', async () => {
    const raised = await raise('dev_aarav', 'eng', LEAVE);
    expect(raised).toMatchObject({ status: 'pending', pendingStage: 'manager', mine: true });
    expect(raised.stages).toEqual([
      { stage: 'manager', state: 'current' },
      { stage: 'hr', state: 'waiting' },
    ]);
    expect(raised.actions).toMatchObject({ canDecide: false, canWithdraw: true });

    // HR cannot jump the queue; the requester cannot approve their own leave.
    expect((await decide('hr', 'hr', raised.id, 'approve')).statusCode).toBe(403);
    expect((await decide('dev_aarav', 'eng', raised.id, 'approve')).statusCode).toBe(403);

    const managerView = (await list('manager', 'eng')).find((item) => item.id === raised.id);
    expect(managerView?.actions.canDecide).toBe(true);
    expect(managerView?.requestedByName).toBe('Aarav Kulkarni');
    const afterManager = viewOf(await decide('manager', 'eng', raised.id, 'approve'));
    expect(afterManager).toMatchObject({ status: 'pending', pendingStage: 'hr' });

    // The manager cannot also take HR's stage.
    expect((await decide('manager', 'eng', raised.id, 'approve')).statusCode).toBe(403);
    const done = viewOf(await decide('hr', 'hr', raised.id, 'approve', 'Enjoy the wedding.'));
    expect(done.status).toBe('approved');
    expect(done.stages.map((stage) => stage.state)).toEqual(['done', 'done']);
    expect(done.history.map((entry) => `${entry.action}:${entry.actorName}`)).toEqual([
      'submitted:Aarav Kulkarni',
      'approved:Rohan Mehta',
      'approved:Priya Menon',
    ]);
    // Decided: nothing more can be done to it.
    expect((await decide('hr', 'hr', raised.id, 'approve')).statusCode).toBe(403);
  });

  it('purchase goes to Finance and IT access goes to IT — never the other way round', async () => {
    const purchase = await raise('dev_meghna', 'eng', PURCHASE);
    const access = await raise('dev_meghna', 'eng', ACCESS);
    await decide('manager', 'eng', purchase.id, 'approve');
    await decide('manager', 'eng', access.id, 'approve');

    expect((await decide('cto', 'tech', purchase.id, 'approve')).statusCode).not.toBe(200);
    expect((await decide('cfo', 'fin', access.id, 'approve')).statusCode).not.toBe(200);
    expect((await decide('hr', 'hr', purchase.id, 'approve')).statusCode).not.toBe(200);

    expect(viewOf(await decide('cfo', 'fin', purchase.id, 'approve')).status).toBe('approved');
    expect(viewOf(await decide('cto', 'tech', access.id, 'approve')).status).toBe('approved');
  });

  it('a rejection needs a reason, ends the request, and the requester sees why', async () => {
    const raised = await raise('dev_aarav', 'eng', PURCHASE);
    expect((await decide('manager', 'eng', raised.id, 'reject')).statusCode).toBe(400);
    const rejected = viewOf(
      await decide('manager', 'eng', raised.id, 'reject', 'Use the shared devices.'),
    );
    expect(rejected.status).toBe('rejected');
    expect(rejected.stages[0]).toEqual({ stage: 'manager', state: 'returned' });
    const mine = (await list('dev_aarav', 'eng')).find((item) => item.id === raised.id);
    expect(mine?.history.at(-1)).toMatchObject({
      action: 'rejected',
      comment: 'Use the shared devices.',
    });
    // Finance never gets a rejected request.
    expect(
      (await list('cfo', 'fin')).some((item) => item.id === raised.id && item.actions.canDecide),
    ).toBe(false);
  });

  it('a manager’s own request goes to the CEO, not to themselves', async () => {
    const raised = await raise('manager', 'eng', LEAVE);
    expect(raised.pendingStage).toBe('manager');
    expect(raised.actions.canDecide).toBe(false);
    expect((await decide('manager', 'eng', raised.id, 'approve')).statusCode).toBe(403);
    expect(viewOf(await decide('ceo', 'eng', raised.id, 'approve')).pendingStage).toBe('hr');
  });

  it('a stage the requester would decide themselves is not required', async () => {
    // HR's own leave: HR has no HR above her, so her manager's decision is the last one.
    const hrLeave = await raise('hr', 'hr', LEAVE);
    expect(hrLeave.stages).toEqual([
      { stage: 'manager', state: 'current' },
      { stage: 'hr', state: 'skipped' },
    ]);
    expect((await decide('hr', 'hr', hrLeave.id, 'approve')).statusCode).toBe(403);
    expect(viewOf(await decide('ceo', 'hr', hrLeave.id, 'approve')).status).toBe('approved');

    // The CEO has no manager: their leave goes straight to HR.
    const ceoLeave = await raise('ceo', 'eng', LEAVE);
    expect(ceoLeave.stages).toEqual([
      { stage: 'manager', state: 'skipped' },
      { stage: 'hr', state: 'current' },
    ]);
    expect(viewOf(await decide('hr', 'hr', ceoLeave.id, 'approve')).status).toBe('approved');

    // The CTO's own access request needs only the manager stage.
    const ctoAccess = await raise('cto', 'tech', ACCESS);
    expect(ctoAccess.stages).toEqual([
      { stage: 'manager', state: 'current' },
      { stage: 'it', state: 'skipped' },
    ]);
    expect(viewOf(await decide('ceo', 'tech', ctoAccess.id, 'approve')).status).toBe('approved');
  });

  it('the manager stage belongs to the request’s own team', async () => {
    const raised = await raise('dev_aarav', 'eng', ACCESS);
    // The CTO manages the Technology team, not Engineering Delivery.
    expect((await decide('cto', 'tech', raised.id, 'approve')).statusCode).not.toBe(200);
    expect(
      (await list('cto', 'tech')).find((item) => item.id === raised.id)?.actions.canDecide,
    ).toBe(false);
  });

  it('people see only the requests they take part in; a hidden one is "not found"', async () => {
    const raised = await raise('dev_aarav', 'eng', LEAVE);
    expect((await list('dev_meghna', 'eng')).some((item) => item.id === raised.id)).toBe(false);
    expect((await list('cfo', 'fin')).some((item) => item.id === raised.id)).toBe(false);
    expect((await list('ceo', 'eng')).some((item) => item.id === raised.id)).toBe(true);
    // Someone who cannot see it cannot withdraw or probe it.
    const probe = await post('dev_meghna', 'eng', `/api/requests/${raised.id}/withdraw`);
    expect(probe.statusCode).toBe(404);
    const stillThere = (await list('dev_aarav', 'eng')).find((item) => item.id === raised.id);
    expect(stillThere?.status).toBe('pending');
  });

  it('only the requester withdraws, and only while it is pending', async () => {
    const raised = await raise('dev_aarav', 'eng', ACCESS);
    expect((await post('manager', 'eng', `/api/requests/${raised.id}/withdraw`)).statusCode).toBe(
      403,
    );
    const withdrawn = viewOf(await post('dev_aarav', 'eng', `/api/requests/${raised.id}/withdraw`));
    expect(withdrawn.status).toBe('withdrawn');
    expect((await decide('manager', 'eng', raised.id, 'approve')).statusCode).toBe(403);
    expect((await post('dev_aarav', 'eng', `/api/requests/${raised.id}/withdraw`)).statusCode).toBe(
      422,
    );
  });

  it('refuses invalid requests, a foreign workspace and a missing session', async () => {
    expect(
      (await post('dev_aarav', 'eng', '/api/requests', { ...LEAVE, endDate: '2026-11-01' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post('dev_aarav', 'eng', '/api/requests', { type: 'holiday', reason: 'Because.' }))
        .statusCode,
    ).toBe(400);
    expect((await post('dev_aarav', 'fin', '/api/requests', LEAVE)).statusCode).toBe(403);
    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/requests?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.eng}`,
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
