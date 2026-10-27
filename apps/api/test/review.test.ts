/**
 * The weekly review: counted from the records, never generated. What was
 * raised and finished, how long it takes, and where work is waiting; the
 * assistant only words the counts, and only the roles that read the
 * organization's insights may see it.
 */

import type { FastifyInstance } from 'fastify';
import type { OfficeRequestSnapshot } from '@nexora/domain-hr';
import type { ProjectTaskSnapshot } from '@nexora/domain-projects';
import { beforeAll, describe, expect, it } from 'vitest';

import { demoIds, type DemoIds, type DemoWorkspaceKey } from '../src/demo/world.js';
import { OfficeAi } from '../src/office/office-ai.js';
import { buildWeeklyReview, reviewByRules, spokenHours } from '../src/office/review.js';
import { reviewFacts } from '../src/routes/review.js';
import { buildTestApp } from './helpers.js';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const ago = (hours: number): string => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

function request(
  overrides: Partial<OfficeRequestSnapshot> & { type: string },
): OfficeRequestSnapshot {
  const { type, ...rest } = overrides;
  return {
    id: `ofr_${Math.random().toString(36).slice(2)}`,
    organizationId: 'org_1',
    workspaceId: 'wsp_eng',
    requestedBy: 'usr_dev',
    details: { type, reason: 'Needed.' },
    stages: ['manager', 'finance'],
    stageIndex: 0,
    status: 'pending',
    history: [{ at: ago(1), actorId: 'usr_dev', action: 'submitted' }],
    createdAt: ago(1),
    updatedAt: ago(1),
    version: 1,
    ...rest,
  } as OfficeRequestSnapshot;
}
const task = (overrides: Partial<ProjectTaskSnapshot>): ProjectTaskSnapshot =>
  ({
    id: `tsk_${Math.random().toString(36).slice(2)}`,
    status: 'todo',
    history: [],
    createdAt: ago(10),
    updatedAt: ago(10),
    version: 1,
    ...overrides,
  }) as ProjectTaskSnapshot;
const review = (requests: OfficeRequestSnapshot[], tasks: ProjectTaskSnapshot[] = []) =>
  buildWeeklyReview({ requests, tasks, summaryOf: () => 'a summary' }, NOW);

describe('the weekly review — counted from the records', () => {
  it('counts what was raised, finished and refused in the last seven days only', () => {
    const result = review([
      request({ type: 'purchase', createdAt: ago(30), updatedAt: ago(6), status: 'approved' }),
      request({ type: 'purchase', createdAt: ago(50), updatedAt: ago(40), status: 'approved' }),
      request({ type: 'leave', createdAt: ago(20), updatedAt: ago(19), status: 'rejected' }),
      request({ type: 'leave', createdAt: ago(5), updatedAt: ago(4), status: 'withdrawn' }),
      // Raised and finished long ago: not this week's business.
      request({ type: 'leave', createdAt: ago(900), updatedAt: ago(800), status: 'approved' }),
    ]);
    expect(result.requests).toMatchObject({
      raised: 4,
      finished: 2,
      refused: 1,
      withdrawn: 1,
      inMotion: 0,
    });
    // 24 hours and 10 hours: the typical (median) time is in between.
    expect(result.requests.typicalHours).toBe(17);
    expect(result.waitingAt).toEqual([]);
  });

  it('says where work is waiting, how long, and what is stuck', () => {
    const atFinance = (hours: number) =>
      request({
        type: 'purchase',
        stageIndex: 1,
        createdAt: ago(hours + 2),
        history: [
          { at: ago(hours + 2), actorId: 'usr_dev', action: 'submitted' },
          { at: ago(hours), actorId: 'usr_mgr', action: 'approved', stage: 'manager' },
          // Help from the assistant is not a move: it does not reset the wait.
          { at: ago(1), actorId: 'usr_cfo', action: 'assisted', stage: 'finance' },
        ],
      });
    const result = review([
      atFinance(60),
      atFinance(5),
      request({ type: 'leave' }),
      request({ type: 'purchase' }),
    ]);
    expect(result.requests.inMotion).toBe(4);
    // The same step is one queue, whichever departments feed it.
    expect(result.waitingAt.find((step) => step.step === 'Manager approves')).toMatchObject({
      count: 2,
      department: 'People, Finance',
    });
    expect(result.waitingAt[0]).toEqual({
      step: 'Finance approves',
      department: 'Finance',
      count: 2,
      longestHours: 60,
    });
    expect(result.waitingLongest[0]).toMatchObject({
      workflow: 'Purchase',
      step: 'Finance approves',
      waitingHours: 60,
      stuck: true,
    });
    expect(result.waitingLongest[1]?.stuck).toBe(false);
    expect(result.requests.assistantHelps).toBe(2);
    expect(result.waitingAt).toHaveLength(2);
    expect(reviewByRules(result)).toContain('most are waiting at “Finance approves” (2');
    expect(reviewByRules(result)).toContain('1 has waited two days or more');
  });

  it('counts a request as written with the assistant only when the help came before it was sent', () => {
    const result = review([
      request({
        type: 'leave',
        history: [
          { at: ago(2), actorId: 'usr_dev', action: 'assisted' },
          { at: ago(2), actorId: 'usr_dev', action: 'submitted' },
        ],
      }),
      request({ type: 'leave' }),
    ]);
    expect(result.requests.draftedWithAssistant).toBe(1);
    expect(reviewFacts(result)).toContain('Requests written with the assistant: 1 of 2');
  });

  it('counts project tasks, and the ones past their due date', () => {
    const result = review(
      [],
      [
        task({ status: 'done', updatedAt: ago(3) }),
        task({ status: 'done', updatedAt: ago(400) }),
        task({ status: 'in_review' }),
        task({ status: 'in_progress', dueDate: '2026-09-28' }),
        task({ status: 'todo', dueDate: '2026-12-01' }),
      ],
    );
    expect(result.tasks).toEqual({ done: 1, inReview: 1, inProgress: 1, todo: 1, overdue: 1 });
    expect(reviewByRules(result)).toContain('Nothing is waiting for anyone right now.');
    expect(reviewByRules(result)).toContain('1 project task is past the due date');
  });

  it('says a length of time the way a person would', () => {
    expect(spokenHours(0.2)).toBe('less than an hour');
    expect(spokenHours(1)).toBe('1 hour');
    expect(spokenHours(20)).toBe('20 hours');
    expect(spokenHours(60)).toBe('3 days');
  });

  it('lets the assistant word the counts, and falls back to the plain text when it cannot', async () => {
    const asked: string[] = [];
    const chat = (answer: string) => ({
      id: 'fake',
      complete: async (input: { messages: { content: string }[] }) => {
        asked.push(input.messages.map((message) => message.content).join('\n'));
        return { content: answer, finishReason: 'stop' as const, model: 'fake' };
      },
    });
    const good = await new OfficeAi({
      chat: chat('{"text":"Three requests moved this week and two wait at Finance."}') as never,
    }).summarise(['Requests raised in the last seven days: 3'], 'plain text');
    expect(good).toEqual({
      text: 'Three requests moved this week and two wait at Finance.',
      source: 'ai',
    });
    expect(asked[0]).toContain('- Requests raised in the last seven days: 3');
    const bad = await new OfficeAi({ chat: chat('no idea') as never }).summarise([], 'plain text');
    expect(bad).toEqual({ text: 'plain text', source: 'rules' });
    expect(await new OfficeAi().summarise([], 'plain text')).toEqual({
      text: 'plain text',
      source: 'rules',
    });
  });
});

describe('the weekly review through the API', () => {
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
  const get = async (persona: string, workspace: DemoWorkspaceKey, path: string) =>
    app.inject({
      method: 'GET',
      url: `${path}?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds[workspace]}`,
      headers: { cookie: await as(persona) },
    });
  const post = async (
    persona: string,
    workspace: DemoWorkspaceKey,
    url: string,
    payload: Record<string, unknown>,
  ) =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie: await as(persona), 'content-type': 'application/json' },
      payload: {
        organizationId: ids.organizationId,
        workspaceId: ids.workspaceIds[workspace],
        ...payload,
      },
    });

  beforeAll(async () => {
    ({ app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } }));
    ids = demoIds();
    await app.ready();
  });

  it('shows the chief executive where a real request is waiting, with who raised it', async () => {
    const raised = await post('dev_aarav', 'eng', '/api/requests', {
      type: 'purchase',
      reason: 'The device lab has no Android 15 phones.',
      values: { item: 'Two Android test phones', amountMinorUnits: 9_000_000 },
    });
    const id = (raised.json() as { request: { id: string } }).request.id;
    const approved = await post('manager', 'eng', `/api/requests/${id}/decision`, {
      decision: 'approve',
    });
    expect(approved.statusCode).toBe(200);

    const response = await get('ceo', 'eng', '/api/review');
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      review: {
        requests: { raised: number; inMotion: number };
        waitingAt: { step: string; count: number }[];
        waitingLongest: { id: string; requestedByName?: string; requestedBy?: string }[];
      };
      summary: string;
      assistant: { connected: boolean };
    };
    expect(body.review.requests).toMatchObject({ raised: 1, inMotion: 1 });
    expect(body.review.waitingAt[0]).toMatchObject({ step: 'Finance approves', count: 1 });
    expect(body.review.waitingLongest[0]).toMatchObject({ id, requestedByName: 'Aarav Kulkarni' });
    // Names, never raw user ids.
    expect(body.review.waitingLongest[0]?.requestedBy).toBeUndefined();
    expect(body.summary).toContain('1 request was raised this week');
    expect(body.assistant.connected).toBe(false);

    const summary = await get('ceo', 'eng', '/api/review/summary');
    expect(summary.json()).toMatchObject({ summary: { source: 'rules' } });
  });

  it('is not for a developer, and not for someone without a session', async () => {
    expect((await get('dev_aarav', 'eng', '/api/review')).statusCode).toBe(403);
    expect((await get('dev_aarav', 'eng', '/api/review/summary')).statusCode).toBe(403);
    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/review?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.eng}`,
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
