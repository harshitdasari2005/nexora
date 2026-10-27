/**
 * Onboarding and assignment through the real API with the demo office:
 * HR starts a hired person's onboarding; HR, IT and the hiring manager each
 * complete only their own checklist items; the last item makes the employee
 * active; only then can the hiring manager assign them to the project.
 */

import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { demoIds, type DemoIds, type DemoWorkspaceKey } from '../src/demo/world.js';
import { buildTestApp } from './helpers.js';

interface ItemView {
  key: string;
  owner: string;
  done: boolean;
  doneByName?: string;
  note?: string;
  canComplete: boolean;
}
interface OnboardingView {
  id: string;
  employeeId: string;
  employeeName: string;
  status: string;
  employeeStatus?: string;
  jobTitle?: string;
  hiringManagerName?: string;
  projectName?: string;
  assignedToProject: boolean;
  canAssign: boolean;
  items: ItemView[];
}

describe('onboarding — from hired to active to assigned', () => {
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
      url: `${path}?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds[workspace]}`,
      headers: { cookie: await as(persona) },
    });

  /** The whole chain up to an accepted offer; returns the new employee id. */
  async function hire(name: string, requester: 'manager' | 'cto' = 'manager'): Promise<string> {
    const workspace: DemoWorkspaceKey = requester === 'manager' ? 'eng' : 'tech';
    const raised = await post(requester, workspace, '/api/hiring/requisitions', {
      jobTitle: 'Backend Developer',
      department: 'Engineering Delivery',
      projectId: ids.projectId,
      headcount: 1,
      employmentType: 'full_time',
      salaryMinMinorUnits: 180_000_000,
      salaryMaxMinorUnits: 240_000_000,
      currency: 'INR',
      justification: 'The mobile banking rebuild needs another engineer.',
      urgency: 'normal',
    });
    expect(raised.statusCode, raised.body).toBe(201);
    const requisitionId = (raised.json() as { requisition: { id: string } }).requisition.id;
    const decision = `/api/hiring/requisitions/${requisitionId}/decision`;
    await post('ceo', 'eng', decision, { decision: 'approve' });
    await post('cfo', 'fin', decision, { decision: 'approve' });
    const opening = (
      (
        await post('hr', 'hr', '/api/recruiting/openings', {
          requisitionId,
          description: 'Build and run the banking backend services.',
        })
      ).json() as { opening: { id: string } }
    ).opening;
    const candidate = (
      (
        await post('hr', 'hr', `/api/recruiting/openings/${opening.id}/candidates`, {
          name,
          email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
          source: 'referral',
        })
      ).json() as { candidate: { id: string } }
    ).candidate;
    const base = `/api/recruiting/candidates/${candidate.id}`;
    await post('hr', 'hr', `${base}/advance`);
    await post('hr', 'hr', `${base}/advance`);
    await post(requester, workspace, `${base}/feedback`, {
      rating: 4,
      recommendation: 'yes',
      notes: 'A strong hire for the team.',
    });
    await post('hr', 'hr', `${base}/offer`, {
      salaryMinorUnits: 200_000_000,
      startDate: '2026-11-01',
    });
    const accepted = await post('hr', 'hr', `${base}/offer/response`, { response: 'accept' });
    expect(accepted.statusCode, accepted.body).toBe(200);
    return (accepted.json() as { employeeId: string }).employeeId;
  }
  async function startOnboarding(employeeId: string): Promise<OnboardingView> {
    const response = await post('hr', 'hr', '/api/onboarding', { employeeId });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { onboarding: OnboardingView }).onboarding;
  }
  const complete = (
    persona: string,
    workspace: DemoWorkspaceKey,
    onboardingId: string,
    item: string,
    note?: string,
  ) =>
    post(persona, workspace, `/api/onboarding/${onboardingId}/items/${item}/complete`, {
      ...(note === undefined ? {} : { note }),
    });
  const viewOf = (response: { json(): unknown }): OnboardingView =>
    (response.json() as { onboarding: OnboardingView }).onboarding;
  const assign = (persona: string, workspace: DemoWorkspaceKey, employeeId: string) =>
    post(persona, workspace, `/api/projects/${ids.projectId}/assignments`, { employeeId });
  const employeeStatus = async (employeeId: string): Promise<string | undefined> =>
    (
      (
        await app.inject({
          method: 'GET',
          url: `/api/employees?organizationId=${ids.organizationId}`,
          headers: { cookie: await as('ceo') },
        })
      ).json() as { employees: { id: string; status: string }[] }
    ).employees.find((employee) => employee.id === employeeId)?.status;

  beforeAll(async () => {
    ({ app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } }));
    ids = demoIds();
    await app.ready();
  });

  it('the whole path: HR starts → HR, IT and the manager tick their items → active → assigned', async () => {
    const employeeId = await hire('Sarah Thomas');
    expect(await employeeStatus(employeeId)).toBe('hired');

    // HR sees the new hire waiting, and starts the onboarding.
    const waiting = (await get('hr', 'hr', '/api/onboarding')).json() as {
      readyToStart: { employeeId: string; name: string; jobTitle?: string }[];
      canStart: boolean;
    };
    expect(waiting.canStart).toBe(true);
    expect(waiting.readyToStart.find((entry) => entry.employeeId === employeeId)).toMatchObject({
      name: 'Sarah Thomas',
      jobTitle: 'Backend Developer',
    });
    const started = await startOnboarding(employeeId);
    expect(started).toMatchObject({
      employeeName: 'Sarah Thomas',
      status: 'in_progress',
      employeeStatus: 'onboarding',
      hiringManagerName: 'Rohan Mehta',
      projectName: 'Mobile Banking Platform',
      assignedToProject: false,
      canAssign: false,
    });
    // HR may complete HR's items only.
    expect(started.items.map((item) => [item.key, item.owner, item.canComplete])).toEqual([
      ['paperwork', 'hr', true],
      ['accounts', 'it', false],
      ['equipment', 'it', false],
      ['buddy', 'manager', false],
      ['orientation', 'hr', true],
    ]);
    expect(await employeeStatus(employeeId)).toBe('onboarding');
    // Not yet active → cannot be assigned.
    expect((await assign('manager', 'eng', employeeId)).statusCode).toBe(422);

    expect((await complete('hr', 'hr', started.id, 'paperwork')).statusCode).toBe(200);
    expect(
      (await complete('dev_aarav', 'eng', started.id, 'accounts', 'Mailbox ready')).statusCode,
    ).toBe(200);
    expect((await complete('dev_meghna', 'eng', started.id, 'equipment')).statusCode).toBe(200);
    expect(
      (await complete('manager', 'eng', started.id, 'buddy', 'Aarav Kulkarni')).statusCode,
    ).toBe(200);
    expect(await employeeStatus(employeeId)).toBe('onboarding'); // one item left

    const last = await complete('hr', 'hr', started.id, 'orientation');
    expect(last.statusCode).toBe(200);
    const finished = viewOf(last);
    expect(finished).toMatchObject({ status: 'completed', employeeStatus: 'active' });
    expect(finished.items.find((item) => item.key === 'accounts')).toMatchObject({
      done: true,
      doneByName: 'Aarav Kulkarni',
      note: 'Mailbox ready',
    });
    expect(finished.items.find((item) => item.key === 'buddy')?.note).toBe('Aarav Kulkarni');
    expect(await employeeStatus(employeeId)).toBe('active');

    // Now the hiring manager can assign the new colleague to the project.
    const managerView = (
      (await get('manager', 'eng', '/api/onboarding')).json() as { onboardings: OnboardingView[] }
    ).onboardings.find((entry) => entry.id === started.id);
    expect(managerView).toMatchObject({ canAssign: true, assignedToProject: false });
    const assigned = await assign('manager', 'eng', employeeId);
    expect(assigned.statusCode, assigned.body).toBe(201);
    expect(assigned.json()).toMatchObject({
      assignment: { projectName: 'Mobile Banking Platform', employeeName: 'Sarah Thomas' },
    });
    const members = (
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${ids.projectId}/members?organizationId=${ids.organizationId}`,
          headers: { cookie: await as('manager') },
        })
      ).json() as { members: { employeeName: string | null }[] }
    ).members;
    expect(members.map((member) => member.employeeName)).toContain('Sarah Thomas');
    // Assigned once: the onboarding now shows it, and a second assignment is refused.
    const after = (
      (await get('manager', 'eng', '/api/onboarding')).json() as { onboardings: OnboardingView[] }
    ).onboardings.find((entry) => entry.id === started.id);
    expect(after).toMatchObject({ canAssign: false, assignedToProject: true });
    expect((await assign('manager', 'eng', employeeId)).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("each item belongs to its owner: nobody ticks another department's item, and an item is ticked once", async () => {
    const onboarding = await startOnboarding(await hire('Owner Check'));
    // HR cannot do IT's or the manager's items; IT cannot do HR's or the manager's; the manager cannot do HR's or IT's.
    for (const [persona, workspace, item] of [
      ['hr', 'hr', 'accounts'],
      ['hr', 'hr', 'buddy'],
      ['dev_aarav', 'eng', 'paperwork'],
      ['dev_aarav', 'eng', 'buddy'],
      ['manager', 'eng', 'paperwork'],
      ['manager', 'eng', 'equipment'],
      ['ceo', 'eng', 'accounts'],
      ['ceo', 'eng', 'paperwork'],
    ] as const) {
      expect(
        (await complete(persona, workspace, onboarding.id, item, 'Someone')).statusCode,
        `${persona} → ${item}`,
      ).toBe(403);
    }
    // The CEO holds the manager capability but is not THIS hire's manager.
    expect((await complete('ceo', 'eng', onboarding.id, 'buddy', 'Someone')).statusCode).toBe(403);
    // The buddy must be named.
    expect((await complete('manager', 'eng', onboarding.id, 'buddy')).statusCode).toBe(400);
    expect((await complete('dev_aarav', 'eng', onboarding.id, 'accounts')).statusCode).toBe(200);
    expect((await complete('dev_meghna', 'eng', onboarding.id, 'accounts')).statusCode).toBe(422);
    expect((await complete('hr', 'hr', onboarding.id, 'parking')).statusCode).toBe(404);
    const state = (
      (await get('hr', 'hr', '/api/onboarding')).json() as { onboardings: OnboardingView[] }
    ).onboardings.find((entry) => entry.id === onboarding.id);
    expect(state?.items.filter((item) => item.done).map((item) => item.key)).toEqual(['accounts']);
  });

  it('onboarding starts once, only for a hired person, and only by HR', async () => {
    const employeeId = await hire('Start Once');
    for (const [persona, workspace] of [
      ['manager', 'eng'],
      ['ceo', 'eng'],
      ['dev_aarav', 'eng'],
    ] as const) {
      expect((await post(persona, workspace, '/api/onboarding', { employeeId })).statusCode).toBe(
        403,
      );
    }
    await startOnboarding(employeeId);
    expect((await post('hr', 'hr', '/api/onboarding', { employeeId })).statusCode).toBe(422); // no longer `hired`
    // A seeded employee was never hired through a request.
    const seeded = (
      (
        await app.inject({
          method: 'GET',
          url: `/api/employees?organizationId=${ids.organizationId}`,
          headers: { cookie: await as('ceo') },
        })
      ).json() as { employees: { id: string; name: string }[] }
    ).employees.find((employee) => employee.name === 'Aarav Kulkarni')!;
    expect((await post('hr', 'hr', '/api/onboarding', { employeeId: seeded.id })).statusCode).toBe(
      422,
    );
    expect(
      (
        await post('hr', 'hr', '/api/onboarding', {
          employeeId: 'emp_00000000-0000-4000-8000-000000000000',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('who sees what: HR, the CEO and IT see all; a manager sees their own hires; Finance sees none', async () => {
    const mine = await startOnboarding(await hire('Manager Hire', 'manager'));
    const ctos = await startOnboarding(await hire('CTO Hire', 'cto'));
    const idsSeenBy = async (persona: string, workspace: DemoWorkspaceKey) => {
      const response = await get(persona, workspace, '/api/onboarding');
      return response.statusCode === 200
        ? (response.json() as { onboardings: OnboardingView[] }).onboardings.map(
            (entry) => entry.id,
          )
        : response.statusCode;
    };
    for (const [persona, workspace] of [
      ['hr', 'hr'],
      ['ceo', 'eng'],
      ['dev_aarav', 'eng'],
    ] as const) {
      expect(await idsSeenBy(persona, workspace), persona).toEqual(
        expect.arrayContaining([mine.id, ctos.id]),
      );
    }
    const manager = await idsSeenBy('manager', 'eng');
    expect(manager).toContain(mine.id);
    expect(manager).not.toContain(ctos.id);
    expect(await idsSeenBy('cfo', 'fin')).toBe(403);
    // A manager cannot tick the buddy item of someone else's hire (reported as not found).
    expect((await complete('manager', 'eng', ctos.id, 'buddy', 'Someone')).statusCode).toBe(404);
    expect((await complete('cto', 'tech', ctos.id, 'buddy', 'Meghna Iyer')).statusCode).toBe(200);
  });

  it('assignment needs the capability, an active employee and a real project of this organization', async () => {
    const employeeId = await hire('Assign Rules');
    const onboarding = await startOnboarding(employeeId);
    // Developers and HR cannot assign people to projects; neither can a manager
    // who is not THIS hire's manager (the CTO holds the same manager capability).
    expect((await assign('dev_aarav', 'eng', employeeId)).statusCode).toBe(403);
    expect((await assign('hr', 'hr', employeeId)).statusCode).toBe(403);
    expect((await assign('cto', 'tech', employeeId)).statusCode).toBe(403);
    expect((await assign('manager', 'eng', employeeId)).statusCode).toBe(422); // still onboarding
    for (const [persona, workspace, item, note] of [
      ['hr', 'hr', 'paperwork', undefined],
      ['dev_aarav', 'eng', 'accounts', undefined],
      ['dev_aarav', 'eng', 'equipment', undefined],
      ['manager', 'eng', 'buddy', 'Meghna Iyer'],
      ['hr', 'hr', 'orientation', undefined],
    ] as const) {
      expect((await complete(persona, workspace, onboarding.id, item, note)).statusCode).toBe(200);
    }
    expect(
      (await post('manager', 'eng', '/api/projects/prj_does_not_exist/assignments', { employeeId }))
        .statusCode,
    ).toBe(404);
    // An employee the manager has no onboarding for is refused outright (403);
    // for the CEO, who may assign anyone, an unknown employee is simply not found.
    for (const [persona, expected] of [
      ['manager', 403],
      ['ceo', 404],
    ] as const) {
      expect(
        (
          await post(persona, 'eng', `/api/projects/${ids.projectId}/assignments`, {
            employeeId: 'emp_00000000-0000-4000-8000-000000000000',
          })
        ).statusCode,
        persona,
      ).toBe(expected);
    }
    // Still not the CTO's hire, even now that the person is active…
    expect((await assign('cto', 'tech', employeeId)).statusCode).toBe(403);
    // …and a manager may assign ONLY their own hire: not a long-standing colleague.
    const seeded = (
      (
        await app.inject({
          method: 'GET',
          url: `/api/employees?organizationId=${ids.organizationId}`,
          headers: { cookie: await as('ceo') },
        })
      ).json() as { employees: { id: string; name: string }[] }
    ).employees.find((employee) => employee.name === 'Tanvir Shaikh')!;
    expect((await assign('manager', 'eng', seeded.id)).statusCode).toBe(403);
    expect((await assign('manager', 'eng', employeeId)).statusCode).toBe(201);
    // The CEO holds the general capability and may assign anyone active.
    expect((await assign('ceo', 'eng', seeded.id)).statusCode).toBe(201);
  });
});
