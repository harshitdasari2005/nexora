/**
 * HR's side of hiring through the real API, with the demo office's real
 * sessions: after the CEO and Finance approve a request, HR opens the
 * position, runs candidates through the pipeline, the hiring manager gives
 * feedback, HR makes an offer inside the approved terms, and an accepted offer
 * becomes an employee record.
 */

import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { demoIds, type DemoIds, type DemoWorkspaceKey } from '../src/demo/world.js';
import { buildTestApp } from './helpers.js';

interface CandidateView {
  id: string;
  name: string;
  email: string;
  stage: string;
  nextStage?: string;
  feedback: { byName?: string; rating: number; stage: string }[];
  offer?: { salaryMinorUnits: number; status: string; startDate: string };
  offerStatus?: string;
  employeeId?: string;
  actions: Record<string, boolean>;
}
interface OpeningView {
  id: string;
  status: string;
  headcount: number;
  offersOut: number;
  hiredCount: number;
  seatsAvailable: number;
  hiringManagerName?: string;
  canManage: boolean;
}

describe('recruiting — HR runs the hire', () => {
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
  const get = async (persona: string, workspace: DemoWorkspaceKey, path: string) =>
    app.inject({
      method: 'GET',
      url: `${path}?${query(workspace)}`,
      headers: { cookie: await as(persona) },
    });

  /** Manager raises → CEO approves → Finance approves. Returns the requisition id. */
  async function approvedRequest(headcount = 1, jobTitle = 'Backend Developer'): Promise<string> {
    const raised = await post('manager', 'eng', '/api/hiring/requisitions', {
      jobTitle,
      department: 'Engineering Delivery',
      headcount,
      employmentType: 'full_time',
      salaryMinMinorUnits: 180_000_000,
      salaryMaxMinorUnits: 240_000_000,
      currency: 'INR',
      justification: 'The mobile banking rebuild needs more backend engineers.',
      urgency: 'normal',
    });
    expect(raised.statusCode, raised.body).toBe(201);
    const id = (raised.json() as { requisition: { id: string } }).requisition.id;
    const decision = `/api/hiring/requisitions/${id}/decision`;
    expect((await post('ceo', 'eng', decision, { decision: 'approve' })).statusCode).toBe(200);
    expect((await post('cfo', 'fin', decision, { decision: 'approve' })).statusCode).toBe(200);
    return id;
  }
  async function openPosition(requisitionId: string): Promise<OpeningView> {
    const response = await post('hr', 'hr', '/api/recruiting/openings', {
      requisitionId,
      description: 'Build and run the mobile banking backend services.',
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { opening: OpeningView }).opening;
  }
  async function addCandidate(openingId: string, name: string): Promise<CandidateView> {
    const response = await post('hr', 'hr', `/api/recruiting/openings/${openingId}/candidates`, {
      name,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      source: 'referral',
      resumeNotes: '8 years of backend experience.',
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { candidate: CandidateView }).candidate;
  }
  const candidateOf = (response: { json(): unknown }): CandidateView =>
    (response.json() as { candidate: CandidateView }).candidate;
  const openingOf = (response: { json(): unknown }): OpeningView =>
    (response.json() as { opening: OpeningView }).opening;
  /** Takes a candidate to the interview stage with the hiring manager's feedback. */
  async function interviewed(openingId: string, name: string): Promise<CandidateView> {
    const candidate = await addCandidate(openingId, name);
    const base = `/api/recruiting/candidates/${candidate.id}`;
    expect((await post('hr', 'hr', `${base}/advance`)).statusCode).toBe(200);
    expect((await post('hr', 'hr', `${base}/advance`)).statusCode).toBe(200);
    const feedback = await post('manager', 'eng', `${base}/feedback`, {
      rating: 4,
      recommendation: 'yes',
      notes: 'Strong system design and clear communication.',
    });
    expect(feedback.statusCode, feedback.body).toBe(200);
    return candidateOf(feedback);
  }
  const offer = (candidateId: string, salaryMinorUnits = 200_000_000) =>
    post('hr', 'hr', `/api/recruiting/candidates/${candidateId}/offer`, {
      salaryMinorUnits,
      startDate: '2026-11-01',
    });

  beforeAll(async () => {
    ({ app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } }));
    ids = demoIds();
    await app.ready();
  });

  it('the whole hire: approved request → HR opens → pipeline → feedback → offer → accepted → employee', async () => {
    const requisitionId = await approvedRequest(1, 'Senior Backend Developer');

    // HR sees the approved request waiting, and opens the position.
    const before = (await get('hr', 'hr', '/api/recruiting/openings')).json() as {
      readyRequisitions: { id: string; requestedByName?: string }[];
      canManage: boolean;
    };
    expect(before.canManage).toBe(true);
    expect(before.readyRequisitions.find((entry) => entry.id === requisitionId)).toMatchObject({
      requestedByName: 'Rohan Mehta',
    });
    const opening = await openPosition(requisitionId);
    expect(opening).toMatchObject({
      status: 'open',
      headcount: 1,
      seatsAvailable: 1,
      hiringManagerName: 'Rohan Mehta',
    });
    // It is no longer "waiting", and it cannot be opened twice.
    const after = (await get('hr', 'hr', '/api/recruiting/openings')).json() as {
      readyRequisitions: { id: string }[];
    };
    expect(after.readyRequisitions.map((entry) => entry.id)).not.toContain(requisitionId);
    expect(
      (
        await post('hr', 'hr', '/api/recruiting/openings', {
          requisitionId,
          description: 'A second posting for the same request.',
        })
      ).statusCode,
    ).toBe(409);

    // Pipeline + the hiring manager's feedback.
    const candidate = await interviewed(opening.id, 'Sarah Thomas');
    expect(candidate.stage).toBe('interview');
    expect(candidate.feedback).toEqual([
      expect.objectContaining({ byName: 'Rohan Mehta', rating: 4, stage: 'interview' }),
    ]);

    // Offer inside the approved range → the seat is held.
    const offered = await offer(candidate.id);
    expect(offered.statusCode, offered.body).toBe(200);
    expect(candidateOf(offered)).toMatchObject({ stage: 'offer', offerStatus: 'extended' });
    expect(openingOf(offered)).toMatchObject({ offersOut: 1, seatsAvailable: 0 });

    // Accepted → hired, the opening is filled, an employee record exists with real details.
    const accepted = await post(
      'hr',
      'hr',
      `/api/recruiting/candidates/${candidate.id}/offer/response`,
      { response: 'accept' },
    );
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(candidateOf(accepted).stage).toBe('hired');
    expect(openingOf(accepted)).toMatchObject({ status: 'filled', hiredCount: 1, offersOut: 0 });
    const employeeId = (accepted.json() as { employeeId: string }).employeeId;
    const employees = (
      (
        await app.inject({
          method: 'GET',
          url: `/api/employees?organizationId=${ids.organizationId}`,
          headers: { cookie: await as('ceo') },
        })
      ).json() as { employees: Record<string, unknown>[] }
    ).employees;
    expect(employees.find((employee) => employee['id'] === employeeId)).toMatchObject({
      name: 'Sarah Thomas',
      status: 'hired',
      email: 'sarah.thomas@example.com',
      jobTitle: 'Senior Backend Developer',
      department: 'Engineering Delivery',
      employmentType: 'full_time',
      startDate: '2026-11-01',
    });
    // The offer is answered once.
    expect(
      (
        await post('hr', 'hr', `/api/recruiting/candidates/${candidate.id}/offer/response`, {
          response: 'accept',
        })
      ).statusCode,
    ).toBe(422);
    // The hiring request now shows HR's progress.
    const requisition = (
      (await get('manager', 'eng', `/api/hiring/requisitions/${requisitionId}`)).json() as {
        requisition: { recruiting?: Record<string, unknown> };
      }
    ).requisition;
    expect(requisition.recruiting).toMatchObject({ status: 'filled', hiredCount: 1, headcount: 1 });
  });

  it('a position can only be opened for a request BOTH the CEO and Finance approved', async () => {
    const raised = await post('manager', 'eng', '/api/hiring/requisitions', {
      jobTitle: 'Not Approved Yet',
      department: 'Engineering',
      headcount: 1,
      employmentType: 'full_time',
      salaryMinMinorUnits: 1,
      salaryMaxMinorUnits: 2,
      currency: 'INR',
      justification: 'A request that is still waiting for decisions.',
      urgency: 'low',
    });
    const id = (raised.json() as { requisition: { id: string } }).requisition.id;
    const open = () =>
      post('hr', 'hr', '/api/recruiting/openings', {
        requisitionId: id,
        description: 'Trying to open before approval.',
      });
    expect((await open()).statusCode).toBe(422); // waiting for the CEO
    await post('ceo', 'eng', `/api/hiring/requisitions/${id}/decision`, { decision: 'approve' });
    expect((await open()).statusCode).toBe(422); // waiting for Finance
    expect(
      (
        await post('hr', 'hr', '/api/recruiting/openings', {
          requisitionId: 'req_00000000-0000-4000-8000-000000000000',
          description: 'A request that does not exist.',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('an offer must be inside the range Finance approved, and needs interview feedback first', async () => {
    const opening = await openPosition(await approvedRequest(1));
    const early = await addCandidate(opening.id, 'Early Offer');
    expect((await offer(early.id)).statusCode).toBe(422); // not interviewed yet
    const candidate = await interviewed(opening.id, 'Range Check');
    expect((await offer(candidate.id, 240_000_001)).statusCode).toBe(422); // above the approved max
    expect((await offer(candidate.id, 179_999_999)).statusCode).toBe(422); // below the approved min
    const state = (await get('hr', 'hr', `/api/recruiting/openings/${opening.id}`)).json() as {
      opening: OpeningView;
      candidates: CandidateView[];
    };
    expect(state.opening).toMatchObject({ offersOut: 0, seatsAvailable: 1 }); // no seat was held
    expect(state.candidates.find((entry) => entry.id === candidate.id)?.stage).toBe('interview');
    expect((await offer(candidate.id, 240_000_000)).statusCode).toBe(200); // exactly the max
  });

  it('never more offers than approved seats; a declined offer frees the seat', async () => {
    const opening = await openPosition(await approvedRequest(1));
    const first = await interviewed(opening.id, 'First Choice');
    const second = await interviewed(opening.id, 'Second Choice');
    expect((await offer(first.id)).statusCode).toBe(200);
    // One approved seat, already held by the first offer.
    const refused = await offer(second.id);
    expect(refused.statusCode).toBe(422);
    expect(refused.body).toContain('no seat is left');

    // Simultaneous second offers cannot both get through either.
    const declined = await post(
      'hr',
      'hr',
      `/api/recruiting/candidates/${first.id}/offer/response`,
      { response: 'decline', note: 'Took another role.' },
    );
    expect(candidateOf(declined)).toMatchObject({ stage: 'withdrawn', offerStatus: 'declined' });
    expect(openingOf(declined)).toMatchObject({ offersOut: 0, seatsAvailable: 1 });
    const third = await interviewed(opening.id, 'Third Choice');
    const race = await Promise.all([offer(second.id), offer(third.id)]);
    expect(race.map((response) => response.statusCode).sort()).toEqual([200, 422]);
    const state = (await get('hr', 'hr', `/api/recruiting/openings/${opening.id}`)).json() as {
      opening: OpeningView;
    };
    expect(state.opening).toMatchObject({ offersOut: 1, hiredCount: 0, seatsAvailable: 0 });
  });

  it('rejecting a candidate with a pending offer rescinds it and frees the seat; closing needs a reason', async () => {
    const opening = await openPosition(await approvedRequest(1));
    const candidate = await interviewed(opening.id, 'Rescinded Offer');
    await offer(candidate.id);
    const close = (payload: Record<string, unknown>) =>
      post('hr', 'hr', `/api/recruiting/candidates/${candidate.id}/close`, payload);
    expect((await close({ outcome: 'reject' })).statusCode).toBe(400);
    const rejected = await close({ outcome: 'reject', reason: 'References did not check out.' });
    expect(candidateOf(rejected)).toMatchObject({ stage: 'rejected', offerStatus: 'declined' });
    expect(openingOf(rejected)).toMatchObject({ offersOut: 0, seatsAvailable: 1 });
    expect((await close({ outcome: 'withdraw', reason: 'too late' })).statusCode).toBe(422);
  });

  it('who sees what: HR and the CEO see offers; the hiring manager sees their opening without pay; others see nothing', async () => {
    const mine = await openPosition(await approvedRequest(1, 'Manager Opening'));
    const candidate = await interviewed(mine.id, 'Pay Privacy');
    await offer(candidate.id, 210_000_000);

    const hrView = (await get('hr', 'hr', `/api/recruiting/openings/${mine.id}`)).json() as {
      candidates: CandidateView[];
    };
    expect(hrView.candidates[0]?.offer).toMatchObject({ salaryMinorUnits: 210_000_000 });
    const ceoView = (await get('ceo', 'eng', `/api/recruiting/openings/${mine.id}`)).json() as {
      opening: OpeningView;
      candidates: CandidateView[];
    };
    expect(ceoView.candidates[0]?.offer).toMatchObject({ salaryMinorUnits: 210_000_000 });
    expect(ceoView.opening.canManage).toBe(false); // the CEO watches; HR runs it

    // The hiring manager: their own opening, feedback visible, NO offer amount.
    const managerResponse = await get('manager', 'eng', `/api/recruiting/openings/${mine.id}`);
    expect(managerResponse.statusCode).toBe(200);
    const managerView = managerResponse.json() as { candidates: CandidateView[] };
    expect(managerView.candidates[0]).toMatchObject({ stage: 'offer', offerStatus: 'extended' });
    expect(managerView.candidates[0]?.offer).toBeUndefined();
    expect(managerResponse.body).not.toContain('210000000');

    // The CTO is a hiring manager too — but not of THIS opening.
    expect((await get('cto', 'tech', `/api/recruiting/openings/${mine.id}`)).statusCode).toBe(404);
    const ctoList = (await get('cto', 'tech', '/api/recruiting/openings')).json() as {
      openings: OpeningView[];
    };
    expect(ctoList.openings.map((opening) => opening.id)).not.toContain(mine.id);
    expect(
      (
        await post('cto', 'tech', `/api/recruiting/candidates/${candidate.id}/feedback`, {
          rating: 1,
          recommendation: 'strong_no',
          notes: 'Feedback on someone else’s opening.',
        })
      ).statusCode,
    ).toBe(404);
    // Developers and Finance have no part in recruiting.
    expect((await get('dev_aarav', 'eng', '/api/recruiting/openings')).statusCode).toBe(403);
    expect((await get('cfo', 'fin', '/api/recruiting/openings')).statusCode).toBe(403);
  });

  it('only HR runs recruiting: the manager and the CEO cannot open, add, move, offer or close', async () => {
    const requisitionId = await approvedRequest(1);
    for (const [persona, workspace] of [
      ['manager', 'eng'],
      ['ceo', 'eng'],
      ['dev_aarav', 'eng'],
    ] as const) {
      expect(
        (
          await post(persona, workspace, '/api/recruiting/openings', {
            requisitionId,
            description: 'Someone other than HR opening a position.',
          })
        ).statusCode,
        persona,
      ).toBe(403);
    }
    const opening = await openPosition(requisitionId);
    const candidate = await addCandidate(opening.id, 'HR Only');
    const base = `/api/recruiting/candidates/${candidate.id}`;
    for (const [url, payload] of [
      [
        `/api/recruiting/openings/${opening.id}/candidates`,
        { name: 'X Y', email: 'x@example.com', source: 'other' },
      ],
      [`${base}/advance`, {}],
      [`${base}/offer`, { salaryMinorUnits: 200_000_000, startDate: '2026-11-01' }],
      [`${base}/offer/response`, { response: 'accept' }],
      [`${base}/close`, { outcome: 'reject', reason: 'Not by the manager.' }],
      [`/api/recruiting/openings/${opening.id}/status`, { action: 'hold' }],
    ] as const) {
      expect((await post('manager', 'eng', url, payload)).statusCode, url).toBe(403);
      expect((await post('ceo', 'eng', url, payload)).statusCode, url).toBe(403);
    }
    // Feedback is the one thing the hiring manager does — once per stage, and only when interviewing.
    const feedback = { rating: 3, recommendation: 'yes', notes: 'Too early to say.' };
    expect((await post('manager', 'eng', `${base}/feedback`, feedback)).statusCode).toBe(422);
    await post('hr', 'hr', `${base}/advance`);
    expect((await post('manager', 'eng', `${base}/feedback`, feedback)).statusCode).toBe(200);
    expect((await post('manager', 'eng', `${base}/feedback`, feedback)).statusCode).toBe(422);
  });

  it('an opening on hold or closed takes no new candidates; closing needs a reason', async () => {
    const opening = await openPosition(await approvedRequest(1));
    const status = (payload: Record<string, unknown>) =>
      post('hr', 'hr', `/api/recruiting/openings/${opening.id}/status`, payload);
    expect(openingOf(await status({ action: 'hold' })).status).toBe('on_hold');
    expect(
      (
        await post('hr', 'hr', `/api/recruiting/openings/${opening.id}/candidates`, {
          name: 'Late Applicant',
          email: 'late@example.com',
          source: 'job_board',
        })
      ).statusCode,
    ).toBe(422);
    expect(openingOf(await status({ action: 'resume' })).status).toBe('open');
    expect((await status({ action: 'close' })).statusCode).toBe(400);
    expect(openingOf(await status({ action: 'close', reason: 'Budget frozen.' })).status).toBe(
      'closed',
    );
  });

  it('scope is verified: no session, a foreign organization and unknown ids are refused', async () => {
    expect(
      (await app.inject({ method: 'GET', url: `/api/recruiting/openings?${query('hr')}` }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/recruiting/openings?organizationId=org_alien&workspaceId=${ids.workspaceIds.hr}`,
          headers: { cookie: await as('hr') },
        })
      ).statusCode,
    ).toBe(403);
    expect((await get('hr', 'eng', '/api/recruiting/openings')).statusCode).toBe(403); // not HR's workspace
    expect((await get('hr', 'hr', '/api/recruiting/openings/job_nope')).statusCode).toBe(404);
    expect(
      (await post('hr', 'hr', '/api/recruiting/candidates/cand_nope/advance')).statusCode,
    ).toBe(404);
  });
});
