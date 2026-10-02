/**
 * @nexora/domain-projects — ProjectTask aggregate root.
 *
 * A piece of work on a project, and the way it moves between two people:
 *
 *   the manager creates it and gives it to someone  →  to do
 *   the assignee starts it                           →  in progress
 *   the assignee hands it in                         →  in review
 *   the reviewer accepts it                          →  done
 *   …or sends it back with a reason                  →  in progress again
 *
 * The rules hold whoever calls: only the assignee works on a task, a task is
 * reviewed by someone other than the person who did the work, and sending
 * work back needs a reason.
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { EntityId, TenantId, WorkspaceId } from '@nexora/contracts/common';

import { InvalidProjectValueError, ProjectDomainError } from '../errors/index.js';

/** A branded task id (`task_…`). */
export type ProjectTaskId = EntityId<'project_task'>;
const TASK_ID = /^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ProjectTaskId = {
  create(): ProjectTaskId {
    return prefixedId('task') as ProjectTaskId;
  },
  from(value: string): ProjectTaskId {
    if (!TASK_ID.test(value)) {
      throw new InvalidProjectValueError('Invalid task id', [
        { path: 'taskId', message: 'Must be a valid task id' },
      ]);
    }
    return value as ProjectTaskId;
  },
};

export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** A step was attempted that the task's current state forbids. */
export class TaskStateError extends ProjectDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The actor may not take this step of the task. */
export class TaskNotPermittedError extends ProjectDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'AUTHORIZATION_ERROR', details);
  }
}

/** One step in a task's life. */
export interface TaskHistoryEntry {
  at: string;
  actorId: string;
  action: 'created' | 'started' | 'submitted' | 'accepted' | 'sent_back' | 'reassigned';
  comment?: string;
}

/** Input for creating a task. */
export interface CreateTaskInput {
  organizationId: TenantId;
  /** The team's workspace the task is managed from. */
  workspaceId: WorkspaceId;
  projectId: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  /** `YYYY-MM-DD`, when there is a due date. */
  dueDate?: string;
  /** The user who will do the work. */
  assigneeId: string;
  createdBy: string;
}

/** A persistence snapshot of the {@link ProjectTask}. */
export interface ProjectTaskSnapshot extends CreateTaskInput {
  id: ProjectTaskId;
  status: TaskStatus;
  history: readonly TaskHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The {@link ProjectTask} aggregate root. */
export class ProjectTask {
  #state: ProjectTaskSnapshot;

  private constructor(snapshot: ProjectTaskSnapshot) {
    this.#state = { ...snapshot, history: [...snapshot.history] };
  }

  /** Creates a task and gives it to its assignee. */
  static create(input: CreateTaskInput, now = nowIso()): ProjectTask {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title.length < 3 || title.length > 160) {
      throw new InvalidProjectValueError('Invalid task', [
        { path: 'title', message: 'Say what needs doing (3–160 characters)' },
      ]);
    }
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (description.length > 2000) {
      throw new InvalidProjectValueError('Invalid task', [
        { path: 'description', message: 'At most 2000 characters' },
      ]);
    }
    if (!TASK_PRIORITIES.includes(input.priority)) {
      throw new InvalidProjectValueError('Invalid task', [
        { path: 'priority', message: `Must be one of: ${TASK_PRIORITIES.join(', ')}` },
      ]);
    }
    if (
      input.dueDate !== undefined &&
      (!DATE.test(input.dueDate) || Number.isNaN(Date.parse(`${input.dueDate}T00:00:00Z`)))
    ) {
      throw new InvalidProjectValueError('Invalid task', [
        { path: 'dueDate', message: 'Give the due date as a date' },
      ]);
    }
    if (typeof input.assigneeId !== 'string' || input.assigneeId.length === 0) {
      throw new InvalidProjectValueError('Invalid task', [
        { path: 'assigneeId', message: 'Choose who will do the work' },
      ]);
    }
    const { description: _ignored, dueDate, ...rest } = input;
    void _ignored;
    return new ProjectTask({
      ...rest,
      title,
      ...(description.length === 0 ? {} : { description }),
      ...(dueDate === undefined ? {} : { dueDate }),
      id: ProjectTaskId.create(),
      status: 'todo',
      history: [{ at: now, actorId: input.createdBy, action: 'created' }],
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
  }

  static hydrate(snapshot: ProjectTaskSnapshot): ProjectTask {
    if (!TASK_STATUSES.includes(snapshot.status)) {
      throw new InvalidProjectValueError('Invalid task status', [
        { path: 'status', message: `Must be one of: ${TASK_STATUSES.join(', ')}` },
      ]);
    }
    return new ProjectTask(snapshot);
  }

  static snapshot(task: ProjectTask): ProjectTaskSnapshot {
    return { ...task.#state, history: [...task.#state.history] };
  }

  get id(): ProjectTaskId {
    return this.#state.id;
  }
  get organizationId(): TenantId {
    return this.#state.organizationId;
  }
  get workspaceId(): WorkspaceId {
    return this.#state.workspaceId;
  }
  get projectId(): string {
    return this.#state.projectId;
  }
  get assigneeId(): string {
    return this.#state.assigneeId;
  }
  get createdBy(): string {
    return this.#state.createdBy;
  }
  get status(): TaskStatus {
    return this.#state.status;
  }
  get version(): number {
    return this.#state.version;
  }

  /** The assignee starts the work (`todo` → `in_progress`). */
  start(actorId: string, now = nowIso()): void {
    this.#assigneeOnly(actorId);
    this.#require('todo', 'started');
    this.#move('in_progress', { at: now, actorId, action: 'started' });
  }

  /** The assignee hands the work in for review (`in_progress` → `in_review`). */
  submit(actorId: string, note: string | undefined, now = nowIso()): void {
    this.#assigneeOnly(actorId);
    this.#require('in_progress', 'handed in');
    const comment = typeof note === 'string' ? note.trim() : '';
    if (comment.length > 1000) {
      throw new InvalidProjectValueError('Invalid note', [
        { path: 'comment', message: 'At most 1000 characters' },
      ]);
    }
    this.#move('in_review', {
      at: now,
      actorId,
      action: 'submitted',
      ...(comment.length === 0 ? {} : { comment }),
    });
  }

  /** The reviewer accepts the work, or sends it back with a reason. */
  review(
    input: { actorId: string; decision: 'accept' | 'send_back'; comment?: string },
    now = nowIso(),
  ): void {
    if (input.actorId === this.#state.assigneeId) {
      throw new TaskNotPermittedError('You cannot review your own work');
    }
    this.#require('in_review', 'reviewed');
    const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
    if (comment.length > 1000) {
      throw new InvalidProjectValueError('Invalid comment', [
        { path: 'comment', message: 'At most 1000 characters' },
      ]);
    }
    if (input.decision === 'send_back') {
      if (comment.length < 3) {
        throw new InvalidProjectValueError('A reason is required to send work back', [
          { path: 'comment', message: 'Say what should change' },
        ]);
      }
      this.#move('in_progress', { at: now, actorId: input.actorId, action: 'sent_back', comment });
      return;
    }
    this.#move('done', {
      at: now,
      actorId: input.actorId,
      action: 'accepted',
      ...(comment.length === 0 ? {} : { comment }),
    });
  }

  /** Gives an unfinished task to someone else. */
  reassign(actorId: string, assigneeId: string, now = nowIso()): void {
    if (this.#state.status === 'done') {
      throw new TaskStateError('A finished task cannot be reassigned');
    }
    if (typeof assigneeId !== 'string' || assigneeId.length === 0) {
      throw new InvalidProjectValueError('Invalid task', [
        { path: 'assigneeId', message: 'Choose who will do the work' },
      ]);
    }
    this.#state.assigneeId = assigneeId;
    // Work handed in by the previous person is not the new person's to defend.
    const status: TaskStatus =
      this.#state.status === 'in_review' ? 'in_progress' : this.#state.status;
    this.#move(status, { at: now, actorId, action: 'reassigned' });
  }

  #assigneeOnly(actorId: string): void {
    if (actorId !== this.#state.assigneeId) {
      throw new TaskNotPermittedError('Only the person the task is assigned to can do this');
    }
  }

  #require(status: TaskStatus, verb: string): void {
    if (this.#state.status !== status) {
      throw new TaskStateError(`This task cannot be ${verb} right now`, {
        status: this.#state.status,
      });
    }
  }

  #move(status: TaskStatus, entry: TaskHistoryEntry): void {
    this.#state.status = status;
    this.#state.history = [...this.#state.history, entry];
    this.#state.updatedAt = entry.at;
    this.#state.version += 1;
  }
}
