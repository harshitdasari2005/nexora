/**
 * Project tasks through the real API with the demo office: the manager creates
 * a task and gives it to a developer; the developer starts it and hands it in;
 * the manager accepts it or sends it back. Developers see only their own
 * tasks; nobody reviews their own work.
 */

import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { demoIds, type DemoIds, type DemoWorkspaceKey } from '../src/demo/world.js';
import { buildTestApp } from './helpers.js';

interface TaskView {
  id: string;
  title: string;
  status: string;
  projectName?: string;
  assigneeId: string;
  assigneeName?: string;
  mine: boolean;
  history: { action: string; actorName?: string; comment?: string }[];
  actions: { canStart: boolean; canSubmit: boolean; canReview: boolean; canReassign: boolean };
}
interface TaskList {
  tasks: TaskView[];
  canManage: boolean;
  assignees: { userId: string; name: string }[];
  projects: { id: string; name: string }[];
}

describe('project tasks — from created to done', () => {
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
      payload: {
        organizationId: ids.organizationId,
        workspaceId: ids.workspaceIds[workspace],
        ...payload,
      },
    });
  const list = async (persona: string, workspace: DemoWorkspaceKey) =>
    app.inject({
      method: 'GET',
      url: `/api/tasks?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds[workspace]}`,
      headers: { cookie: await as(persona) },
    });
  const create = async (title: string, assignee: keyof DemoIds['userIds'] = 'dev_aarav') => {
    const response = await post('manager', 'eng', '/api/tasks', {
      projectId: ids.projectId,
      title,
      priority: 'high',
      dueDate: '2026-11-20',
      assigneeId: ids.userIds[assignee],
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { task: TaskView }).task;
  };
  const viewOf = (response: { json(): unknown }): TaskView =>
    (response.json() as { task: TaskView }).task;

  beforeAll(async () => {
    ({ app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } }));
    ids = demoIds();
    await app.ready();
  });

  it('the manager sees who on the team can be given work, and the projects', async () => {
    const body = (await list('manager', 'eng')).json() as TaskList;
    expect(body.canManage).toBe(true);
    expect(body.assignees.map((person) => person.name)).toEqual(
      expect.arrayContaining(['Aarav Kulkarni', 'Meghna Iyer', 'Rohan Mehta']),
    );
    expect(body.assignees.some((person) => person.name === 'Anika Rao')).toBe(false);
    expect(body.projects.map((project) => project.name)).toContain('Mobile Banking Platform');
    // No emails or raw member records leave the server.
    expect(JSON.stringify(body)).not.toContain('@');
  });

  it('the whole path: created → started → handed in → sent back → handed in → accepted', async () => {
    const task = await create('Build the login screen');
    expect(task).toMatchObject({
      status: 'todo',
      projectName: 'Mobile Banking Platform',
      assigneeName: 'Aarav Kulkarni',
    });
    expect(task.actions).toMatchObject({ canStart: false, canReview: false, canReassign: true });

    const mine = ((await list('dev_aarav', 'eng')).json() as TaskList).tasks.find(
      (item) => item.id === task.id,
    );
    expect(mine).toMatchObject({ mine: true, actions: { canStart: true, canSubmit: false } });

    expect(viewOf(await post('dev_aarav', 'eng', `/api/tasks/${task.id}/start`)).status).toBe(
      'in_progress',
    );
    const handedIn = viewOf(
      await post('dev_aarav', 'eng', `/api/tasks/${task.id}/submit`, { comment: 'Ready.' }),
    );
    expect(handedIn.status).toBe('in_review');

    // Sending work back needs a reason.
    expect(
      (await post('manager', 'eng', `/api/tasks/${task.id}/review`, { decision: 'send_back' }))
        .statusCode,
    ).toBe(400);
    const back = viewOf(
      await post('manager', 'eng', `/api/tasks/${task.id}/review`, {
        decision: 'send_back',
        comment: 'Add the error states.',
      }),
    );
    expect(back.status).toBe('in_progress');

    await post('dev_aarav', 'eng', `/api/tasks/${task.id}/submit`, { comment: 'Added.' });
    const done = viewOf(
      await post('manager', 'eng', `/api/tasks/${task.id}/review`, { decision: 'accept' }),
    );
    expect(done.status).toBe('done');
    expect(done.history.map((entry) => `${entry.action}:${entry.actorName}`)).toEqual([
      'created:Rohan Mehta',
      'started:Aarav Kulkarni',
      'submitted:Aarav Kulkarni',
      'sent_back:Rohan Mehta',
      'submitted:Aarav Kulkarni',
      'accepted:Rohan Mehta',
    ]);
    expect(done.actions).toEqual({
      canStart: false,
      canSubmit: false,
      canReview: false,
      canReassign: false,
    });
  });

  it('a developer sees and works on only their own tasks', async () => {
    const task = await create('Write the API client', 'dev_meghna');
    const aaravs = ((await list('dev_aarav', 'eng')).json() as TaskList).tasks;
    expect(aaravs.some((item) => item.id === task.id)).toBe(false);
    expect(((await list('dev_aarav', 'eng')).json() as TaskList).assignees).toEqual([]);
    // Someone else's task is "not found", not "forbidden".
    expect((await post('dev_aarav', 'eng', `/api/tasks/${task.id}/start`)).statusCode).toBe(404);
    // A developer cannot create, review or reassign.
    expect(
      (
        await post('dev_aarav', 'eng', '/api/tasks', {
          projectId: ids.projectId,
          title: 'Give myself a task',
          priority: 'low',
          assigneeId: ids.userIds.dev_aarav,
        })
      ).statusCode,
    ).toBe(403);
    await post('dev_meghna', 'eng', `/api/tasks/${task.id}/start`);
    await post('dev_meghna', 'eng', `/api/tasks/${task.id}/submit`);
    expect(
      (await post('dev_meghna', 'eng', `/api/tasks/${task.id}/review`, { decision: 'accept' }))
        .statusCode,
    ).toBe(403);
    const state = ((await list('manager', 'eng')).json() as TaskList).tasks.find(
      (item) => item.id === task.id,
    );
    expect(state?.status).toBe('in_review');
  });

  it('nobody reviews their own work: a manager’s own task is reviewed by the CEO', async () => {
    const task = await create('Plan the sprint', 'manager');
    await post('manager', 'eng', `/api/tasks/${task.id}/start`);
    const handedIn = viewOf(await post('manager', 'eng', `/api/tasks/${task.id}/submit`));
    expect(handedIn.actions.canReview).toBe(false);
    expect(
      (await post('manager', 'eng', `/api/tasks/${task.id}/review`, { decision: 'accept' }))
        .statusCode,
    ).toBe(403);
    expect(
      viewOf(await post('ceo', 'eng', `/api/tasks/${task.id}/review`, { decision: 'accept' }))
        .status,
    ).toBe('done');
  });

  it('a task goes only to someone on the team whose role does project work', async () => {
    const attempt = (assigneeId: string) =>
      post('manager', 'eng', '/api/tasks', {
        projectId: ids.projectId,
        title: 'Review the budget',
        priority: 'normal',
        assigneeId,
      });
    // The CFO is not on the Engineering Delivery team.
    expect((await attempt(ids.userIds.cfo)).statusCode).toBe(400);
    // The CEO sits in the team but does not take project tasks.
    expect((await attempt(ids.userIds.ceo)).statusCode).toBe(400);
    expect((await attempt('usr_nobody')).statusCode).toBe(400);
    // A project of another organization (or none) is refused.
    expect(
      (
        await post('manager', 'eng', '/api/tasks', {
          projectId: 'prj_00000000-0000-0000-0000-000000000000',
          title: 'Ghost project work',
          priority: 'normal',
          assigneeId: ids.userIds.dev_aarav,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('a task can be given to someone else, who then owns the work', async () => {
    const task = await create('Set up CI');
    await post('dev_aarav', 'eng', `/api/tasks/${task.id}/start`);
    const moved = viewOf(
      await post('manager', 'eng', `/api/tasks/${task.id}/reassign`, {
        assigneeId: ids.userIds.dev_meghna,
      }),
    );
    expect(moved.assigneeName).toBe('Meghna Iyer');
    expect((await post('dev_aarav', 'eng', `/api/tasks/${task.id}/submit`)).statusCode).toBe(404);
    expect(viewOf(await post('dev_meghna', 'eng', `/api/tasks/${task.id}/submit`)).status).toBe(
      'in_review',
    );
  });

  it('roles with no part in project work, a foreign workspace and no session are refused', async () => {
    expect((await list('hr', 'hr')).statusCode).toBe(403);
    expect((await list('cfo', 'fin')).statusCode).toBe(403);
    expect((await list('dev_aarav', 'fin')).statusCode).toBe(403);
    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/tasks?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.eng}`,
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
