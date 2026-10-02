/**
 * The Guided Demo story: the eight steps are DERIVED from the hiring records,
 * so the guide always knows where the story stands and whose turn it is.
 *
 * Part 1 checks the pure derivation state by state. Part 2 walks the whole
 * story through the real API with the demo office and reads the guide back
 * after every action — and checks who may read it.
 */

import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { deriveStory, type DemoStory, type StoryFacts } from '../src/demo/story.js';
import { demoIds, type DemoIds, type DemoWorkspaceKey } from '../src/demo/world.js';
import { buildTestApp, login } from './helpers.js';

const REQUEST = {
  jobTitle: 'Senior Backend Developer',
  status: 'pending_executive',
  raisedBy: 'manager',
  executiveNotRequired: false,
  executiveApproved: false,
  hasProject: true,
} as const;

const facts = (overrides: Partial<StoryFacts> = {}): StoryFacts => ({
  candidates: [],
  assigned: false,
  ...overrides,
});
const states = (story: DemoStory): string =>
  story.steps.map((step) => `${step.key}:${step.state}`).join(' ');

describe('deriveStory', () => {
  it('starts with the manager: nobody has asked for a hire', () => {
    const story = deriveStory(facts());
    expect(story.finished).toBe(false);
    expect(story.subject).toBeUndefined();
    expect(story.next).toMatchObject({ step: 'raise', who: ['manager'], screen: 'hiring' });
    expect(states(story)).toBe(
      'raise:current ceo:waiting finance:waiting open:waiting candidates:waiting offer:waiting onboard:waiting assign:waiting',
    );
  });

  it('goes to the CEO, then to Finance, then to HR', () => {
    const atCeo = deriveStory(facts({ requisition: REQUEST }));
    expect(atCeo.subject).toBe('Senior Backend Developer');
    expect(atCeo.next).toMatchObject({ step: 'ceo', who: ['ceo'] });

    const atFinance = deriveStory(
      facts({ requisition: { ...REQUEST, status: 'pending_finance', executiveApproved: true } }),
    );
    expect(atFinance.next).toMatchObject({ step: 'finance', who: ['cfo'] });
    expect(atFinance.steps[1]?.state).toBe('done');

    const atHr = deriveStory(
      facts({ requisition: { ...REQUEST, status: 'approved', executiveApproved: true } }),
    );
    expect(atHr.next).toMatchObject({ step: 'open', who: ['hr'], screen: 'recruiting' });
    expect(atHr.steps[2]?.state).toBe('done');
  });

  it('a rejection goes back to the person who raised the request', () => {
    const story = deriveStory(
      facts({
        requisition: {
          ...REQUEST,
          status: 'changes_requested',
          raisedBy: 'cto',
          returnedFrom: 'finance',
        },
      }),
    );
    expect(story.steps[0]).toMatchObject({ state: 'returned', who: ['cto'] });
    expect(story.steps[0]?.detail).toContain('Finance sent the request back');
    expect(story.next).toMatchObject({ step: 'raise', who: ['cto'] });
  });

  it('skips the CEO decision when the CEO raised the request', () => {
    const story = deriveStory(
      facts({
        requisition: {
          ...REQUEST,
          status: 'pending_finance',
          raisedBy: 'ceo',
          executiveNotRequired: true,
        },
      }),
    );
    expect(story.steps[1]?.state).toBe('skipped');
    expect(story.next).toMatchObject({ step: 'finance', who: ['cfo'] });
  });

  const approved = { ...REQUEST, status: 'approved', executiveApproved: true };
  const open = { status: 'open' };

  it('walks a candidate from application to offer, asking the manager for feedback', () => {
    const none = deriveStory(facts({ requisition: approved, opening: open }));
    expect(none.next).toMatchObject({ step: 'candidates', who: ['hr'], action: 'Add a candidate' });

    const applied = deriveStory(
      facts({
        requisition: approved,
        opening: open,
        candidates: [{ name: 'Sarah Thomas', stage: 'applied', feedbackCount: 0 }],
      }),
    );
    expect(applied.next).toMatchObject({ who: ['hr'] });
    expect(applied.next?.action).toBe('Move Sarah Thomas on to the interview');

    const interview = deriveStory(
      facts({
        requisition: approved,
        opening: open,
        candidates: [{ name: 'Sarah Thomas', stage: 'interview', feedbackCount: 0 }],
      }),
    );
    expect(interview.next).toMatchObject({ step: 'candidates', who: ['manager'] });

    const reviewed = deriveStory(
      facts({
        requisition: approved,
        opening: open,
        candidates: [{ name: 'Sarah Thomas', stage: 'interview', feedbackCount: 1 }],
      }),
    );
    expect(reviewed.next).toMatchObject({ who: ['hr'], action: 'Make Sarah Thomas an offer' });

    const offered = deriveStory(
      facts({
        requisition: approved,
        opening: open,
        candidates: [{ name: 'Sarah Thomas', stage: 'offer', feedbackCount: 1 }],
      }),
    );
    expect(offered.steps[4]?.state).toBe('done');
    expect(offered.next).toMatchObject({ step: 'offer', who: ['hr'] });
  });

  it('ignores candidates who were rejected or withdrew', () => {
    const story = deriveStory(
      facts({
        requisition: approved,
        opening: open,
        candidates: [{ name: 'Old Candidate', stage: 'rejected', feedbackCount: 2 }],
      }),
    );
    expect(story.next?.action).toBe('Add a candidate');
  });

  it('has nobody to wait for while recruiting is on hold', () => {
    const story = deriveStory(facts({ requisition: approved, opening: { status: 'on_hold' } }));
    expect(story.next).toBeUndefined();
    expect(story.finished).toBe(false);
    expect(story.steps[4]?.detail).toBe('HR has put recruiting on hold.');
  });

  const hired = {
    requisition: approved,
    opening: { status: 'filled' },
    candidates: [{ name: 'Sarah Thomas', stage: 'hired', feedbackCount: 1 }],
    hire: { name: 'Sarah Thomas' },
    projectName: 'Mobile Banking Platform',
  };
  const item = (owner: 'hr' | 'it' | 'manager', done: boolean) => ({
    owner,
    title: `${owner} item`,
    done,
  });

  it('onboarding waits on exactly the people whose items are still open', () => {
    const notStarted = deriveStory(facts(hired));
    expect(notStarted.next).toMatchObject({ step: 'onboard', who: ['hr'], screen: 'onboarding' });

    const started = deriveStory(
      facts({
        ...hired,
        onboarding: {
          completed: false,
          items: [item('hr', true), item('it', false), item('it', false), item('manager', false)],
        },
      }),
    );
    expect(started.next?.who).toEqual(['dev_aarav', 'manager']);
    expect(started.steps[6]?.detail).toBe('3 of 4 onboarding items are still open.');
  });

  it('ends when the manager has put the new colleague on the project', () => {
    const onboarded = { completed: true, items: [item('hr', true), item('it', true)] };
    const ready = deriveStory(facts({ ...hired, onboarding: onboarded }));
    expect(ready.next).toMatchObject({ step: 'assign', who: ['manager'] });
    expect(ready.next?.action).toBe('Assign Sarah Thomas to Mobile Banking Platform');
    expect(ready.finished).toBe(false);

    const finished = deriveStory(facts({ ...hired, onboarding: onboarded, assigned: true }));
    expect(finished.next).toBeUndefined();
    expect(finished.finished).toBe(true);
    expect(finished.steps.every((step) => step.state === 'done')).toBe(true);
  });

  it('never needs an assignment when the request named no project', () => {
    const story = deriveStory(
      facts({
        ...hired,
        requisition: { ...approved, hasProject: false },
        onboarding: { completed: true, items: [item('hr', true)] },
      }),
    );
    expect(story.steps[7]?.state).toBe('skipped');
    expect(story.finished).toBe(true);
  });

  it('carries no pay', () => {
    const story = deriveStory(facts({ ...hired, assigned: true }));
    expect(JSON.stringify(story)).not.toMatch(/salary|MinorUnits|currency|INR/i);
  });
});

describe('GET /api/demo/story — the guide follows the real records', () => {
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
  const post = async (
    persona: string,
    workspace: DemoWorkspaceKey,
    url: string,
    payload: Record<string, unknown> = {},
  ) => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: await as(persona), 'content-type': 'application/json' },
      payload: {
        organizationId: ids.organizationId,
        workspaceId: ids.workspaceIds[workspace],
        ...payload,
      },
    });
    expect(response.statusCode, `${url}: ${response.body}`).toBeLessThan(300);
    return response.json() as Record<string, never>;
  };
  async function story(persona = 'dev_meghna'): Promise<DemoStory> {
    const response = await app.inject({
      method: 'GET',
      url: '/api/demo/story',
      headers: { cookie: await as(persona) },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as DemoStory;
  }

  beforeAll(async () => {
    ({ app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } }));
    await app.ready();
    ids = demoIds();
  });

  it('is refused without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/demo/story' });
    expect(response.statusCode).toBe(401);
  });

  it('is refused to a signed-in user who is not one of the demo office', async () => {
    const outsider = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/demo/story',
      headers: { cookie: outsider },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('steps');
  });

  it('walks the whole story, naming whose turn it is after every action', async () => {
    expect((await story()).next).toMatchObject({ step: 'raise', who: ['manager'] });

    const raised = await post('manager', 'eng', '/api/hiring/requisitions', {
      jobTitle: 'Senior Backend Developer',
      department: 'Engineering Delivery',
      projectId: ids.projectId,
      headcount: 1,
      employmentType: 'full_time',
      salaryMinMinorUnits: 180_000_000,
      salaryMaxMinorUnits: 240_000_000,
      currency: 'INR',
      justification: 'The mobile banking rebuild needs another engineer.',
      urgency: 'high',
    });
    const requisitionId = (raised as unknown as { requisition: { id: string } }).requisition.id;
    const decision = `/api/hiring/requisitions/${requisitionId}/decision`;
    let now = await story();
    expect(now.subject).toBe('Senior Backend Developer');
    expect(now.next).toMatchObject({ step: 'ceo', who: ['ceo'] });

    // The CEO sends it back: the story returns to the manager.
    await post('ceo', 'eng', decision, { decision: 'reject', comment: 'Say which project.' });
    now = await story();
    expect(now.steps[0]).toMatchObject({ state: 'returned', who: ['manager'] });
    expect(now.next).toMatchObject({ step: 'raise', who: ['manager'] });

    const revised = await app.inject({
      method: 'PUT',
      url: `/api/hiring/requisitions/${requisitionId}`,
      headers: { cookie: await as('manager'), 'content-type': 'application/json' },
      payload: {
        organizationId: ids.organizationId,
        workspaceId: ids.workspaceIds.eng,
        jobTitle: 'Senior Backend Developer',
        department: 'Engineering Delivery',
        projectId: ids.projectId,
        headcount: 1,
        employmentType: 'full_time',
        salaryMinMinorUnits: 180_000_000,
        salaryMaxMinorUnits: 240_000_000,
        currency: 'INR',
        justification: 'For the Mobile Banking Platform rebuild, due in Q4.',
        urgency: 'high',
      },
    });
    expect(revised.statusCode, revised.body).toBe(200);
    expect((await story()).next).toMatchObject({ step: 'ceo', who: ['ceo'] });

    await post('ceo', 'eng', decision, { decision: 'approve' });
    expect((await story()).next).toMatchObject({ step: 'finance', who: ['cfo'] });

    await post('cfo', 'fin', decision, { decision: 'approve' });
    expect((await story()).next).toMatchObject({ step: 'open', who: ['hr'] });

    const opening = (
      (await post('hr', 'hr', '/api/recruiting/openings', {
        requisitionId,
        description: 'Build and run the banking backend services.',
      })) as unknown as { opening: { id: string } }
    ).opening;
    expect((await story()).next).toMatchObject({ step: 'candidates', action: 'Add a candidate' });

    const candidate = (
      (await post('hr', 'hr', `/api/recruiting/openings/${opening.id}/candidates`, {
        name: 'Sarah Thomas',
        email: 'sarah.thomas@example.com',
        source: 'referral',
      })) as unknown as { candidate: { id: string } }
    ).candidate;
    const base = `/api/recruiting/candidates/${candidate.id}`;
    expect((await story()).next?.who).toEqual(['hr']);
    await post('hr', 'hr', `${base}/advance`);
    await post('hr', 'hr', `${base}/advance`);
    expect((await story()).next).toMatchObject({ step: 'candidates', who: ['manager'] });

    await post('manager', 'eng', `${base}/feedback`, {
      rating: 5,
      recommendation: 'strong_yes',
      notes: 'Excellent system design.',
    });
    expect((await story()).next).toMatchObject({
      who: ['hr'],
      action: 'Make Sarah Thomas an offer',
    });

    await post('hr', 'hr', `${base}/offer`, {
      salaryMinorUnits: 210_000_000,
      startDate: '2026-11-01',
    });
    expect((await story()).next).toMatchObject({ step: 'offer', who: ['hr'] });

    const accepted = await post('hr', 'hr', `${base}/offer/response`, { response: 'accept' });
    const employeeId = (accepted as unknown as { employeeId: string }).employeeId;
    now = await story();
    expect(now.steps[5]?.detail).toBe('Sarah Thomas accepted the offer and was hired.');
    expect(now.next).toMatchObject({ step: 'onboard', who: ['hr'] });

    const onboarding = (
      (await post('hr', 'hr', '/api/onboarding', { employeeId })) as unknown as {
        onboarding: { id: string };
      }
    ).onboarding;
    const item = (persona: string, workspace: DemoWorkspaceKey, key: string, note?: string) =>
      post(
        persona,
        workspace,
        `/api/onboarding/${onboarding.id}/items/${key}/complete`,
        note === undefined ? {} : { note },
      );
    expect((await story()).next?.who).toEqual(['hr', 'dev_aarav', 'manager']);
    await item('hr', 'hr', 'paperwork');
    await item('hr', 'hr', 'orientation');
    expect((await story()).next?.who).toEqual(['dev_aarav', 'manager']);
    await item('dev_aarav', 'eng', 'accounts');
    await item('dev_aarav', 'eng', 'equipment');
    expect((await story()).next?.who).toEqual(['manager']);
    await item('manager', 'eng', 'buddy', 'Aarav Kulkarni');
    now = await story();
    expect(now.next).toMatchObject({ step: 'assign', who: ['manager'] });
    expect(now.finished).toBe(false);

    await post('manager', 'eng', `/api/projects/${ids.projectId}/assignments`, { employeeId });
    now = await story();
    expect(now.finished).toBe(true);
    expect(now.next).toBeUndefined();
    expect(now.steps.map((step) => step.state)).toEqual(Array(8).fill('done'));
    // The guide is the same for everyone in the office, and it never carries pay.
    expect(await story('cfo')).toEqual(now);
    expect(JSON.stringify(now)).not.toMatch(/21000|18000|24000|INR|salary/i);
  });
});

describe('GET /api/demo/story — demo mode off', () => {
  it('does not exist', async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/api/demo/story' });
    expect(response.statusCode).toBe(404);
  });
});
