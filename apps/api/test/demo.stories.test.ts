/**
 * The Guided Demo's story lines: hiring, a project from proposal to release,
 * and one story per office workflow. Each is derived from the real records,
 * and "whose turn it is" comes from the same authority rules the routes
 * enforce — so the guide never names someone the server would refuse.
 */

import type { FastifyInstance } from 'fastify';
import { findWorkflow } from '@nexora/domain-hr';
import { beforeAll, describe, expect, it } from 'vitest';

import { deriveProjectStory, deriveWorkflowStory, STORIES } from '../src/demo/stories.js';
import type { NamedDemoStory } from '../src/demo/story.js';
import { demoIds, type DemoIds, type DemoWorkspaceKey } from '../src/demo/world.js';
import { buildTestApp, login } from './helpers.js';

describe('story lines — derivation', () => {
  it('offers hiring, the project story and one story per workflow, for every department', () => {
    expect(STORIES.slice(0, 2).map((story) => story.key)).toEqual(['hiring', 'project']);
    expect(STORIES.length).toBeGreaterThanOrEqual(27);
    expect(new Set(STORIES.map((story) => story.key)).size).toBe(STORIES.length);
    expect(new Set(STORIES.map((story) => story.department))).toEqual(
      new Set([
        'Leadership',
        'People',
        'Engineering',
        'Marketing',
        'Sales',
        'Customer support',
        'Finance',
        'IT and security',
        'Legal and admin',
      ]),
    );
  });

  it('a workflow story starts with someone asking, then follows the workflow’s own stages', () => {
    const leave = findWorkflow('leave')!;
    const fresh = deriveWorkflowStory(leave, undefined);
    expect(fresh.steps.map((step) => `${step.key}:${step.state}`)).toEqual([
      'raise:current',
      'manager:waiting',
      'hr:waiting',
    ]);
    expect(fresh.next).toMatchObject({ step: 'raise', who: ['dev_aarav'], screen: 'requests' });
    expect(fresh.steps.map((step) => step.owner)).toEqual([
      'Anyone in the office',
      'The requester’s manager',
      'HR',
    ]);

    const waiting = deriveWorkflowStory(leave, {
      status: 'pending',
      summary: '2026-11-10, 2026-11-14, vacation',
      stages: [
        { key: 'manager', state: 'done' },
        { key: 'hr', state: 'current' },
      ],
      pendingWho: ['hr'],
      at: {},
    });
    expect(waiting.next).toMatchObject({
      step: 'hr',
      who: ['hr'],
      action: 'HR approves and records it',
    });
    expect(waiting.finished).toBe(false);
  });

  it('a refused request sends the story back to its start; a completed one finishes it', () => {
    const leave = findWorkflow('leave')!;
    const refused = deriveWorkflowStory(leave, {
      status: 'rejected',
      summary: 'x',
      stages: [
        { key: 'manager', state: 'returned' },
        { key: 'hr', state: 'waiting' },
      ],
      pendingWho: [],
      at: {},
    });
    expect(refused.finished).toBe(false);
    expect(refused.next).toMatchObject({ step: 'raise', who: ['dev_aarav'] });
    const complete = deriveWorkflowStory(leave, {
      status: 'approved',
      summary: 'x',
      stages: [
        { key: 'manager', state: 'done' },
        { key: 'hr', state: 'skipped' },
      ],
      pendingWho: [],
      at: {},
    });
    expect(complete).toMatchObject({ finished: true });
    expect(complete.next).toBeUndefined();
  });

  it('the project story waits for the proposal before any work can be given out', () => {
    const fresh = deriveProjectStory({ projectOpened: false });
    expect(fresh.steps.map((step) => `${step.key}:${step.state}`)).toEqual([
      'propose:current',
      'ceo:waiting',
      'finance:waiting',
      'assign:waiting',
      'build:waiting',
      'review:waiting',
      'release:waiting',
    ]);
    expect(fresh.next).toMatchObject({ step: 'propose', who: ['cto'] });
  });
});

describe('story lines through the API', () => {
  let app: FastifyInstance;
  let ids: DemoIds;
  const cookies = new Map<string, string>();
  const HOME: Record<string, DemoWorkspaceKey> = {
    ceo: 'eng',
    cto: 'tech',
    manager: 'eng',
    dev_aarav: 'eng',
    dev_meghna: 'eng',
    hr: 'hr',
    cfo: 'fin',
    marketing: 'mkt',
    sales: 'sales',
    support: 'support',
    legal: 'legal',
  };

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
  const story = async (key: string, persona = 'dev_meghna'): Promise<NamedDemoStory> => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/demo/story?story=${encodeURIComponent(key)}`,
      headers: { cookie: await as(persona) },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as NamedDemoStory;
  };
  /** Acts as `persona`, from the workspace the guide named (or their own). */
  const post = async <T>(
    persona: string,
    url: string,
    payload: Record<string, unknown> = {},
    workspaceId?: string,
  ): Promise<T> => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: await as(persona), 'content-type': 'application/json' },
      payload: {
        organizationId: ids.organizationId,
        workspaceId: workspaceId ?? ids.workspaceIds[HOME[persona] as DemoWorkspaceKey],
        ...payload,
      },
    });
    expect(response.statusCode, `${persona} ${url}: ${response.body}`).toBeLessThan(300);
    return response.json() as T;
  };
  /**
   * Does what the guide says: the FIRST person it names takes the pending
   * stage, from the workspace it names. If the guide were wrong about who may
   * act, the server would refuse and this would fail.
   */
  const follow = async (key: string, requestId: string, comment?: string): Promise<string> => {
    const now = await story(key);
    const who = now.next?.who[0];
    expect(who, `${key}: the guide names nobody`).toBeDefined();
    await post(
      who as string,
      `/api/requests/${requestId}/decision`,
      { decision: 'approve', ...(comment === undefined ? {} : { comment }) },
      now.next?.at?.[who as never],
    );
    return who as string;
  };

  beforeAll(async () => {
    ({ app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } }));
    ids = demoIds();
    await app.ready();
  });

  it('lists every story with where it stands', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/demo/stories',
      headers: { cookie: await as('ceo') },
    });
    expect(response.statusCode).toBe(200);
    const { stories } = response.json() as {
      stories: { key: string; status: string; stepCount: number; waitingFor: string[] }[];
    };
    expect(stories.map((entry) => entry.key)).toEqual(STORIES.map((entry) => entry.key));
    expect(stories.every((entry) => entry.status === 'not_started')).toBe(true);
    expect(stories.find((entry) => entry.key === 'flow.campaign')).toMatchObject({
      stepCount: 6,
      waitingFor: ['marketing'],
    });
  });

  it('marketing: the campaign story names the right person at every step', async () => {
    const key = 'flow.campaign';
    expect((await story(key)).next).toMatchObject({ step: 'raise', who: ['marketing'] });
    const { request } = await post<{ request: { id: string } }>('marketing', '/api/requests', {
      type: 'campaign',
      reason: 'Festive season is our best window.',
      values: {
        name: 'Diwali savings offer',
        audience: 'Salaried customers',
        goal: '2,000 new accounts',
        budget: 50_000_000,
        launchDate: '2026-10-20',
      },
    });
    const walked: string[] = [];
    walked.push(await follow(key, request.id));
    walked.push(await follow(key, request.id));
    walked.push(await follow(key, request.id, 'Emails went out on the 20th.'));
    walked.push(await follow(key, request.id, '2,340 new accounts.'));
    expect(walked).toEqual(['cfo', 'legal', 'marketing', 'marketing']);
    const done = await story(key);
    expect(done).toMatchObject({
      finished: true,
      title: 'Marketing campaign',
      department: 'Marketing',
    });
    expect(done.steps.map((step) => step.state)).toEqual([
      'done',
      'skipped',
      'done',
      'done',
      'done',
      'done',
    ]);
  });

  it('a decision that falls to its own requester is shown going up to the CEO, in that team', async () => {
    const key = 'flow.content';
    const { request } = await post<{ request: { id: string } }>('marketing', '/api/requests', {
      type: 'content',
      reason: 'For first-time borrowers.',
      values: { title: 'Five ways to save on EMIs', channel: 'blog', draft: 'Pay a little extra…' },
    });
    const now = await story(key);
    expect(now.next).toMatchObject({ step: 'marketing', who: ['ceo'] });
    // The CEO acts from the Marketing team, and the guide says so.
    expect(now.next?.at).toEqual({ ceo: ids.workspaceIds.mkt });
    expect(await follow(key, request.id)).toBe('ceo');
    expect(await follow(key, request.id)).toBe('marketing');
    expect((await story(key)).finished).toBe(true);
  });

  it('people: the leave story goes developer → manager → HR', async () => {
    const key = 'flow.leave';
    const { request } = await post<{ request: { id: string } }>('dev_aarav', '/api/requests', {
      type: 'leave',
      reason: 'Family wedding.',
      values: { kind: 'vacation', startDate: '2026-11-10', endDate: '2026-11-14' },
    });
    // The manager first; the CEO, who also sits in the team, is named after him.
    expect((await story(key)).next?.who).toEqual(['manager', 'ceo']);
    expect(await follow(key, request.id)).toBe('manager');
    expect(await follow(key, request.id)).toBe('hr');
    expect((await story(key)).finished).toBe(true);
  });

  it('the project story: proposed, approved, opened, work given out, done, reviewed, released', async () => {
    const key = 'project';
    expect((await story(key)).next).toMatchObject({ step: 'propose', who: ['cto'] });

    const { request: proposal } = await post<{ request: { id: string } }>('cto', '/api/requests', {
      type: 'project_proposal',
      reason: 'Competitors launched it last month.',
      values: {
        name: 'Instant Loan Approval',
        customer: 'Small-business owners',
        problem: 'They wait five days for a decision.',
        announcement: 'Lumen now approves small-business loans in ten minutes.',
        cost: 300_000_000,
      },
    });
    let now = await story(key);
    expect(now.next).toMatchObject({ step: 'ceo', who: ['ceo'] });
    expect(now.next?.at).toEqual({ ceo: ids.workspaceIds.tech });
    await follow(key, proposal.id);
    // Finance's seat is held by the CFO and the Controller: either may take it.
    expect((await story(key)).next).toMatchObject({ step: 'finance', who: ['cfo', 'controller'] });
    await follow(key, proposal.id);

    // Approval opened the project: it now exists for the team to work on.
    const projects = (
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects?organizationId=${ids.organizationId}`,
          headers: { cookie: await as('manager') },
        })
      ).json() as { projects: { id: string; name: string }[] }
    ).projects;
    const project = projects.find((entry) => entry.name === 'Instant Loan Approval');
    expect(project).toBeDefined();
    now = await story(key);
    expect(now.steps[2]).toMatchObject({ state: 'done' });
    expect(now.next).toMatchObject({ step: 'assign', who: ['manager'], screen: 'tasks' });

    const { task } = await post<{ task: { id: string } }>('manager', '/api/tasks', {
      projectId: project?.id,
      title: 'Build the eligibility check',
      priority: 'high',
      assigneeId: ids.userIds.dev_aarav,
    });
    now = await story(key);
    expect(now.next).toMatchObject({
      step: 'build',
      who: ['dev_aarav'],
      action: 'Start “Build the eligibility check”',
    });
    await post('dev_aarav', `/api/tasks/${task.id}/start`);
    expect((await story(key)).next?.action).toBe(
      'Finish “Build the eligibility check” and hand it in',
    );
    await post('dev_aarav', `/api/tasks/${task.id}/submit`);
    now = await story(key);
    // The developer cannot review their own work: the guide names the manager.
    expect(now.next).toMatchObject({ step: 'review', who: ['manager', 'ceo'] });
    await post('manager', `/api/tasks/${task.id}/review`, { decision: 'accept' });

    now = await story(key);
    expect(now.next).toMatchObject({ step: 'release', who: ['dev_aarav'], screen: 'requests' });
    const { request: release } = await post<{ request: { id: string } }>(
      'dev_aarav',
      '/api/requests',
      {
        type: 'release',
        reason: 'The eligibility check is ready.',
        values: {
          version: 'Instant Loan Approval 1.0',
          changes: 'First version of the eligibility check.',
          rollback: 'Switch the feature flag off.',
        },
      },
    );
    expect(await follow(key, release.id)).toBe('manager');
    await follow(key, release.id);
    await follow(key, release.id, 'Released to 10% of users, no errors.');
    const done = await story(key);
    expect(done.finished).toBe(true);
    expect(done.steps.map((step) => step.state)).toEqual(Array(7).fill('done'));
    expect(done.subject).toBe('Instant Loan Approval');
  });

  it('the hiring story is still the default, and unknown stories or outsiders are refused', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/demo/story',
      headers: { cookie: await as('ceo') },
    });
    expect(response.json()).toMatchObject({ key: 'hiring', title: 'Hiring a new colleague' });
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/demo/story?story=flow.nope',
      headers: { cookie: await as('ceo') },
    });
    expect(unknown.statusCode).toBe(404);
    const outsider = await login(app);
    for (const url of ['/api/demo/stories', '/api/demo/story?story=project']) {
      const refused = await app.inject({ method: 'GET', url, headers: { cookie: outsider } });
      expect(refused.statusCode, url).toBe(403);
    }
    const anonymous = await app.inject({ method: 'GET', url: '/api/demo/stories' });
    expect(anonymous.statusCode).toBe(401);
  });
});
