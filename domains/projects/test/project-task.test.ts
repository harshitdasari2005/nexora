/**
 * ProjectTask: work moves to do → in progress → in review → done, only the
 * assignee works on it, nobody reviews their own work, and sending work back
 * needs a reason.
 */

import { describe, expect, it } from 'vitest';

import { ProjectTask, TaskNotPermittedError, TaskStateError } from '../src/index.js';

const create = (overrides: Record<string, unknown> = {}) =>
  ProjectTask.create({
    organizationId: 'org_1' as never,
    workspaceId: 'wsp_eng' as never,
    projectId: 'prj_1',
    title: 'Build the login screen',
    priority: 'normal',
    assigneeId: 'usr_dev',
    createdBy: 'usr_manager',
    ...overrides,
  } as never);

describe('ProjectTask', () => {
  it('starts as to do, given to its assignee', () => {
    const task = create({ description: '  With OTP.  ', dueDate: '2026-11-20' });
    expect(task.status).toBe('todo');
    expect(ProjectTask.snapshot(task)).toMatchObject({
      assigneeId: 'usr_dev',
      createdBy: 'usr_manager',
      description: 'With OTP.',
      dueDate: '2026-11-20',
    });
  });

  it('moves through the whole path: start, hand in, accept', () => {
    const task = create();
    task.start('usr_dev');
    expect(task.status).toBe('in_progress');
    task.submit('usr_dev', 'Ready for review.');
    expect(task.status).toBe('in_review');
    task.review({ actorId: 'usr_manager', decision: 'accept' });
    expect(task.status).toBe('done');
    expect(ProjectTask.snapshot(task).history.map((entry) => entry.action)).toEqual([
      'created',
      'started',
      'submitted',
      'accepted',
    ]);
  });

  it('only the assignee works on a task', () => {
    const task = create();
    expect(() => task.start('usr_manager')).toThrow(TaskNotPermittedError);
    task.start('usr_dev');
    expect(() => task.submit('usr_other', undefined)).toThrow(TaskNotPermittedError);
    expect(task.status).toBe('in_progress');
  });

  it('steps cannot be skipped or repeated', () => {
    const task = create();
    expect(() => task.submit('usr_dev', undefined)).toThrow(TaskStateError);
    expect(() => task.review({ actorId: 'usr_manager', decision: 'accept' })).toThrow(
      TaskStateError,
    );
    task.start('usr_dev');
    expect(() => task.start('usr_dev')).toThrow(TaskStateError);
  });

  it('nobody reviews their own work', () => {
    const task = create({ assigneeId: 'usr_manager' });
    task.start('usr_manager');
    task.submit('usr_manager', undefined);
    expect(() => task.review({ actorId: 'usr_manager', decision: 'accept' })).toThrow(
      TaskNotPermittedError,
    );
    expect(task.status).toBe('in_review');
  });

  it('work is sent back with a reason and can be handed in again', () => {
    const task = create();
    task.start('usr_dev');
    task.submit('usr_dev', undefined);
    expect(() => task.review({ actorId: 'usr_manager', decision: 'send_back' })).toThrow(
      /reason is required/,
    );
    task.review({ actorId: 'usr_manager', decision: 'send_back', comment: 'Add error states.' });
    expect(task.status).toBe('in_progress');
    task.submit('usr_dev', 'Added.');
    task.review({ actorId: 'usr_manager', decision: 'accept' });
    expect(task.status).toBe('done');
  });

  it('a task can go to someone else until it is done; handed-in work goes back to in progress', () => {
    const task = create();
    task.start('usr_dev');
    task.submit('usr_dev', undefined);
    task.reassign('usr_manager', 'usr_other');
    expect(task.assigneeId).toBe('usr_other');
    expect(task.status).toBe('in_progress');
    expect(() => task.submit('usr_dev', undefined)).toThrow(TaskNotPermittedError);
    task.submit('usr_other', undefined);
    task.review({ actorId: 'usr_manager', decision: 'accept' });
    expect(() => task.reassign('usr_manager', 'usr_dev')).toThrow(TaskStateError);
  });

  it('refuses a task without a real title, priority, date or assignee', () => {
    expect(() => create({ title: 'x' })).toThrow();
    expect(() => create({ priority: 'urgent' })).toThrow();
    expect(() => create({ dueDate: 'soon' })).toThrow();
    expect(() => create({ assigneeId: '' })).toThrow();
  });

  it('survives storage: a hydrated task behaves the same', () => {
    const task = create();
    task.start('usr_dev');
    const again = ProjectTask.hydrate(structuredClone(ProjectTask.snapshot(task)));
    expect(again.status).toBe('in_progress');
    again.submit('usr_dev', undefined);
    expect(again.version).toBe(task.version + 1);
  });
});
