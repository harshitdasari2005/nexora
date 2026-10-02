/**
 * The office hiring chain through the real API, with the demo office's real
 * sessions: the Team Manager raises a hiring request, the CEO decides, then
 * Finance decides; a rejection returns it to the Manager; nobody decides their
 * own request; each stage belongs to a different role.
 */

import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { demoIds, type DemoIds, type DemoWorkspaceKey } from '../src/demo/world.js';
import { buildTestApp } from './helpers.js';

interface View {
  id: string;
  status: string;
  pendingStage?: string;
  round: number;
  requestedBy: string;
  requestedByName?: string;
  headcount: number;
  history: {
    action: string;
    stage?: string;
    actorName?: string;
    comment?: string;
    round: number;
  }[];
  actions: {
    canDecide: boolean;
    decideBlockedReason?: string;
    canRevise: boolean;
    canWithdraw: boolean;
  };
}

describe('hiring requisitions — the office chain', () => {
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
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    const cookie = ((Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '').split(';')[0]!;
    cookies.set(persona, cookie);
    return cookie;
  }
  const scope = (workspace: DemoWorkspaceKey) => ({
    organizationId: ids.organizationId,
    workspaceId: ids.workspaceIds[workspace],
  });
  const query = (workspace: DemoWorkspaceKey) =>
    `organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds[workspace]}`;
  const send = async (
    persona: string,
    method: 'POST' | 'PUT',
    url: string,
    payload: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      headers: { cookie: await as(persona), 'content-type': 'application/json' },
      payload,
    });
  const get = async (persona: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { cookie: await as(persona) } });

  const DETAILS = {
    jobTitle: 'Senior Backend Developer',
    department: 'Engineering Delivery',
    headcount: 2,
    employmentType: 'full_time',
    salaryMinMinorUnits: 180_000_000,
    salaryMaxMinorUnits: 240_000_000,
    currency: 'INR',
    justification: 'The mobile banking rebuild needs two more backend engineers.',
    urgency: 'high',
    targetStartDate: '2026-11-01',
  };

  /** Raises a request as `persona` from `workspace`; returns its view. */
  async function raise(
    persona = 'manager',
    workspace: DemoWorkspaceKey = 'eng',
    overrides: Record<string, unknown> = {},
  ): Promise<View> {
    const response = await send(persona, 'POST', '/api/hiring/requisitions', {
      ...scope(workspace),
      ...DETAILS,
      ...overrides,
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { requisition: View }).requisition;
  }
  const decide = (
    persona: string,
    workspace: DemoWorkspaceKey,
    id: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ) =>
    send(persona, 'POST', `/api/hiring/requisitions/${id}/decision`, {
      ...scope(workspace),
      decision,
      ...(comment === undefined ? {} : { comment }),
    });
  const read = async (persona: string, workspace: DemoWorkspaceKey, id: string) =>
    get(persona, `/api/hiring/requisitions/${id}?${query(workspace)}`);
  const viewOf = (response: { json(): unknown }): View =>
    (response.json() as { requisition: View }).requisition;

  beforeAll(async () => {
    ({ app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } }));
    ids = demoIds();
    await app.ready();
  });

  it('Manager raises → CEO approves → Finance approves → approved, with the full named trail', async () => {
    const raised = await raise('manager', 'eng', { projectId: ids.projectId });
    expect(raised).toMatchObject({
      status: 'pending_executive',
      pendingStage: 'executive',
      requestedBy: ids.userIds.manager,
      requestedByName: 'Rohan Mehta',
    });
    // The requester can withdraw, but can neither revise yet nor decide.
    expect(raised.actions).toEqual({ canDecide: false, canRevise: false, canWithdraw: true });

    // It is the CEO's turn — and only the CEO's.
    expect(viewOf(await read('ceo', 'eng', raised.id)).actions.canDecide).toBe(true);
    expect(viewOf(await read('cfo', 'fin', raised.id)).actions.canDecide).toBe(false);

    const executive = await decide('ceo', 'eng', raised.id, 'approve', 'The roadmap needs it.');
    expect(executive.statusCode).toBe(200);
    expect(viewOf(executive)).toMatchObject({ status: 'pending_finance', pendingStage: 'finance' });

    // Now Finance's turn; the CEO has no finance authority.
    expect(viewOf(await read('ceo', 'eng', raised.id)).actions.canDecide).toBe(false);
    expect(viewOf(await read('cfo', 'fin', raised.id)).actions.canDecide).toBe(true);

    const finance = await decide('cfo', 'fin', raised.id, 'approve', 'Within the delivery budget.');
    expect(finance.statusCode).toBe(200);
    const approved = viewOf(finance);
    expect(approved.status).toBe('approved');
    expect(approved.pendingStage).toBeUndefined();
    expect(
      approved.history.map((entry) => [entry.action, entry.stage, entry.actorName, entry.comment]),
    ).toEqual([
      ['submitted', undefined, 'Rohan Mehta', undefined],
      ['approved', 'executive', 'Anika Rao', 'The roadmap needs it.'],
      ['approved', 'finance', 'Karan Malhotra', 'Within the delivery budget.'],
    ]);
    // Nothing more to decide.
    expect((await decide('cfo', 'fin', raised.id, 'approve')).statusCode).toBe(409);
    expect(JSON.stringify(approved)).not.toMatch(/@lumen-capital/); // names, never emails
  });

  it('each stage needs its own role: wrong-role and out-of-order decisions are refused and change nothing', async () => {
    const raised = await raise();
    // Finance cannot decide before the CEO has (it is not their stage).
    expect((await decide('cfo', 'fin', raised.id, 'approve')).statusCode).toBe(403);
    // The requester cannot approve their own request (no executive authority at all).
    expect((await decide('manager', 'eng', raised.id, 'approve')).statusCode).toBe(403);
    // HR can see every request but decides nothing.
    expect((await read('hr', 'hr', raised.id)).statusCode).toBe(200);
    expect((await decide('hr', 'hr', raised.id, 'approve')).statusCode).toBe(403);
    expect(viewOf(await read('ceo', 'eng', raised.id)).status).toBe('pending_executive');

    expect((await decide('ceo', 'eng', raised.id, 'approve')).statusCode).toBe(200);
    // The CEO cannot ALSO take the finance decision.
    expect((await decide('ceo', 'fin', raised.id, 'approve')).statusCode).toBe(403);
    expect((await decide('ceo', 'eng', raised.id, 'approve')).statusCode).toBe(403);
    const after = viewOf(await read('ceo', 'eng', raised.id));
    expect(after.status).toBe('pending_finance');
    expect(after.history).toHaveLength(2);
  });

  it('a request raised by the CEO skips the executive stage; the CEO still cannot decide it; Finance can', async () => {
    const raised = await raise('ceo', 'eng', { jobTitle: 'Chief of Staff', headcount: 1 });
    expect(raised).toMatchObject({ status: 'pending_finance', pendingStage: 'finance' });
    expect(raised.history.map((entry) => entry.action)).toEqual([
      'submitted',
      'executive_not_required',
    ]);
    expect(raised.actions.canDecide).toBe(false);
    expect((await decide('ceo', 'fin', raised.id, 'approve')).statusCode).toBe(403);
    // Anyone in the Finance team (the Controller) holds the finance authority.
    expect((await decide('controller', 'fin', raised.id, 'approve')).statusCode).toBe(200);
    expect(viewOf(await read('ceo', 'eng', raised.id)).status).toBe('approved');
  });

  it('a rejection needs a reason and goes back to the Manager, who revises and resubmits', async () => {
    const raised = await raise();
    expect((await decide('ceo', 'eng', raised.id, 'reject')).statusCode).toBe(400);
    expect((await decide('ceo', 'eng', raised.id, 'reject', '   ')).statusCode).toBe(400);

    const rejected = await decide('ceo', 'eng', raised.id, 'reject', 'One engineer is enough.');
    expect(rejected.statusCode).toBe(200);
    expect(viewOf(rejected).status).toBe('changes_requested');

    const mine = viewOf(await read('manager', 'eng', raised.id));
    expect(mine.actions).toEqual({ canDecide: false, canRevise: true, canWithdraw: true });
    expect(mine.history.at(-1)).toMatchObject({
      action: 'rejected',
      stage: 'executive',
      actorName: 'Anika Rao',
      comment: 'One engineer is enough.',
    });

    // Only the requester revises.
    const intruder = await send('ceo', 'PUT', `/api/hiring/requisitions/${raised.id}`, {
      ...scope('eng'),
      ...DETAILS,
      headcount: 1,
    });
    expect(intruder.statusCode).toBe(403);

    const revised = await send('manager', 'PUT', `/api/hiring/requisitions/${raised.id}`, {
      ...scope('eng'),
      ...DETAILS,
      headcount: 1,
    });
    expect(revised.statusCode).toBe(200);
    expect(viewOf(revised)).toMatchObject({ status: 'pending_executive', round: 2, headcount: 1 });

    // The chain starts again, all the way through.
    expect((await decide('ceo', 'eng', raised.id, 'approve')).statusCode).toBe(200);
    const financeReject = await decide('cfo', 'fin', raised.id, 'reject', 'Lower the salary band.');
    expect(viewOf(financeReject).status).toBe('changes_requested');
    // A request that is not returned cannot be revised.
    const approvedElsewhere = await raise();
    expect(
      (
        await send('manager', 'PUT', `/api/hiring/requisitions/${approvedElsewhere.id}`, {
          ...scope('eng'),
          ...DETAILS,
        })
      ).statusCode,
    ).toBe(422);
  });

  it('only the requester withdraws, and not once it is approved', async () => {
    const raised = await raise();
    const withdrawUrl = `/api/hiring/requisitions/${raised.id}/withdraw`;
    expect((await send('ceo', 'POST', withdrawUrl, scope('eng'))).statusCode).toBe(403);
    const withdrawn = await send('manager', 'POST', withdrawUrl, {
      ...scope('eng'),
      comment: 'Filled internally.',
    });
    expect(viewOf(withdrawn).status).toBe('withdrawn');
    expect((await decide('ceo', 'eng', raised.id, 'approve')).statusCode).toBe(409);

    const approved = await raise();
    await decide('ceo', 'eng', approved.id, 'approve');
    await decide('cfo', 'fin', approved.id, 'approve');
    expect(
      (
        await send(
          'manager',
          'POST',
          `/api/hiring/requisitions/${approved.id}/withdraw`,
          scope('eng'),
        )
      ).statusCode,
    ).toBe(422);
  });

  it('visibility: requesters see their own; CEO, Finance and HR see all; developers see none', async () => {
    const managers = await raise('manager', 'eng', { jobTitle: 'Manager Request' });
    const ctos = await raise('cto', 'tech', { jobTitle: 'CTO Request', department: 'Technology' });

    const list = async (persona: string, workspace: DemoWorkspaceKey) => {
      const response = await get(persona, `/api/hiring/requisitions?${query(workspace)}`);
      return {
        status: response.statusCode,
        ids:
          response.statusCode === 200
            ? (response.json() as { requisitions: View[] }).requisitions.map((entry) => entry.id)
            : [],
        canCreate: (response.json() as { canCreate?: boolean }).canCreate,
      };
    };
    const manager = await list('manager', 'eng');
    expect(manager.ids).toContain(managers.id);
    expect(manager.ids).not.toContain(ctos.id);
    expect(manager.canCreate).toBe(true);
    const cto = await list('cto', 'tech');
    expect(cto.ids).toContain(ctos.id);
    expect(cto.ids).not.toContain(managers.id);
    // Someone else's request is reported exactly like one that does not exist.
    expect((await read('cto', 'tech', managers.id)).statusCode).toBe(404);
    expect((await read('cto', 'tech', 'req_00000000-0000-4000-8000-000000000000')).statusCode).toBe(
      404,
    );
    expect((await read('cto', 'tech', 'not-an-id')).statusCode).toBe(404);

    for (const [persona, workspace] of [
      ['ceo', 'eng'],
      ['cfo', 'fin'],
      ['hr', 'hr'],
    ] as const) {
      const all = await list(persona, workspace);
      expect(all.ids, persona).toEqual(expect.arrayContaining([managers.id, ctos.id]));
    }
    expect((await list('hr', 'hr')).canCreate).toBe(false);

    // The IT team neither raises nor sees hiring requests.
    expect((await list('dev_aarav', 'eng')).status).toBe(403);
    expect(
      (await send('dev_aarav', 'POST', '/api/hiring/requisitions', { ...scope('eng'), ...DETAILS }))
        .statusCode,
    ).toBe(403);
    // HR may read but not raise.
    expect(
      (await send('hr', 'POST', '/api/hiring/requisitions', { ...scope('hr'), ...DETAILS }))
        .statusCode,
    ).toBe(403);
  });

  it('scope and input are verified: no session, foreign scope, forged fields and bad values are refused', async () => {
    const raised = await raise();
    expect(
      (await app.inject({ method: 'GET', url: `/api/hiring/requisitions?${query('eng')}` }))
        .statusCode,
    ).toBe(401);
    // A workspace the caller is not a member of / a foreign organization.
    expect((await get('manager', `/api/hiring/requisitions?${query('fin')}`)).statusCode).toBe(403);
    expect(
      (
        await get(
          'manager',
          `/api/hiring/requisitions?organizationId=org_alien&workspaceId=${ids.workspaceIds.eng}`,
        )
      ).statusCode,
    ).toBe(403);
    // The body can never name the requester, the stage, the status or the decider:
    // unknown fields are dropped by the schema and have no effect.
    const forged = await send('manager', 'POST', '/api/hiring/requisitions', {
      ...scope('eng'),
      ...DETAILS,
      requestedBy: ids.userIds.ceo,
      status: 'approved',
      stage: 'finance',
      requesterIsExecutive: true,
    });
    expect(forged.statusCode).toBe(201);
    expect(viewOf(forged)).toMatchObject({
      requestedBy: ids.userIds.manager,
      status: 'pending_executive',
      pendingStage: 'executive',
    });
    // Naming a stage in a decision does not move it: the CEO still decides the
    // EXECUTIVE stage (the one it is waiting at), never the finance one.
    const staged = await send('ceo', 'POST', `/api/hiring/requisitions/${raised.id}/decision`, {
      ...scope('eng'),
      decision: 'approve',
      stage: 'finance',
      actorId: ids.userIds.cfo,
    });
    expect(staged.statusCode).toBe(200);
    expect(viewOf(staged).status).toBe('pending_finance');
    expect(viewOf(staged).history.at(-1)).toMatchObject({
      stage: 'executive',
      actorName: 'Anika Rao',
    });
    // Invalid values.
    for (const bad of [
      { headcount: 0 },
      { salaryMinMinorUnits: 10, salaryMaxMinorUnits: 5 },
      { currency: 'RUPEE' },
      { justification: 'short' },
      { targetStartDate: '2026-13-45' },
      { projectId: 'prj_does_not_exist' },
    ]) {
      expect(
        (
          await send('manager', 'POST', '/api/hiring/requisitions', {
            ...scope('eng'),
            ...DETAILS,
            ...bad,
          })
        ).statusCode,
        JSON.stringify(bad),
      ).toBe(400);
    }
    expect(viewOf(await read('ceo', 'eng', raised.id)).status).toBe('pending_finance');
  });
});
