/**
 * @nexora/app-web — project tasks client.
 *
 * A manager creates a task and gives it to someone on the team; that person
 * starts it and hands it in; the manager accepts it or sends it back. The
 * server computes what the caller may do with every task (`actions`).
 */

import { api } from './api.js';
import type { HiringScope } from './hiring.js';

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high';

export interface ProjectTask {
  id: string;
  projectId: string;
  projectName?: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  dueDate?: string;
  status: TaskStatus;
  assigneeId: string;
  assigneeName?: string;
  createdByName?: string;
  /** The task is assigned to the caller. */
  mine: boolean;
  history: readonly {
    at: string;
    actorName?: string;
    action: 'created' | 'started' | 'submitted' | 'accepted' | 'sent_back' | 'reassigned';
    comment?: string;
  }[];
  createdAt: string;
  updatedAt: string;
  actions: { canStart: boolean; canSubmit: boolean; canReview: boolean; canReassign: boolean };
}

export interface TaskBoard {
  tasks: ProjectTask[];
  canManage: boolean;
  /** People on this team who can be given work (managers only). */
  assignees: { userId: string; name: string }[];
  projects: { id: string; name: string }[];
}

export interface NewTask {
  projectId: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  dueDate?: string;
  assigneeId: string;
}

const query = (scope: HiringScope): string =>
  `organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;
const post = (path: string, scope: HiringScope, body: Record<string, unknown> = {}) =>
  api<unknown>(path, { method: 'POST', body: JSON.stringify({ ...scope, ...body }) });

export function listTasks(scope: HiringScope): Promise<TaskBoard> {
  return api(`/tasks?${query(scope)}`);
}
export const createTask = (scope: HiringScope, task: NewTask) => post('/tasks', scope, { ...task });
export const startTask = (scope: HiringScope, id: string) =>
  post(`/tasks/${encodeURIComponent(id)}/start`, scope);
export const submitTask = (scope: HiringScope, id: string, comment: string) =>
  post(
    `/tasks/${encodeURIComponent(id)}/submit`,
    scope,
    comment.trim() === '' ? {} : { comment: comment.trim() },
  );
export const reviewTask = (
  scope: HiringScope,
  id: string,
  decision: 'accept' | 'send_back',
  comment: string,
) =>
  post(`/tasks/${encodeURIComponent(id)}/review`, scope, {
    decision,
    ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
  });
export const reassignTask = (scope: HiringScope, id: string, assigneeId: string) =>
  post(`/tasks/${encodeURIComponent(id)}/reassign`, scope, { assigneeId });

export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};

/** How far each project is: tasks done out of all its tasks. */
export function projectProgress(
  tasks: readonly Pick<ProjectTask, 'projectId' | 'projectName' | 'status'>[],
): { projectId: string; name: string; done: number; total: number }[] {
  const byProject = new Map<string, { name: string; done: number; total: number }>();
  for (const task of tasks) {
    const entry = byProject.get(task.projectId) ?? {
      name: task.projectName ?? 'Project',
      done: 0,
      total: 0,
    };
    entry.total += 1;
    if (task.status === 'done') entry.done += 1;
    byProject.set(task.projectId, entry);
  }
  return [...byProject].map(([projectId, entry]) => ({ projectId, ...entry }));
}

/** What a history entry says, in plain words. */
export function taskHistoryVerb(action: ProjectTask['history'][number]['action']): string {
  switch (action) {
    case 'created':
      return 'created the task';
    case 'started':
      return 'started work';
    case 'submitted':
      return 'handed it in';
    case 'accepted':
      return 'accepted the work';
    case 'sent_back':
      return 'sent it back';
    case 'reassigned':
      return 'gave it to someone else';
  }
}
