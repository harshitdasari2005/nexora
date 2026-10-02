/**
 * @nexora/app-api — the weekly review.
 *
 * What an office's leader looks at once a week: how much work was raised and
 * finished, how long it takes, and above all WHERE it is waiting. Everything
 * here is counted from the records (office requests and project tasks); the
 * assistant may put the numbers into sentences, it never produces them.
 */

import {
  findWorkflow,
  findWorkflowStage,
  type OfficeRequestSnapshot,
  type WorkflowDefinition,
} from '@nexora/domain-hr';
import type { ProjectTaskSnapshot } from '@nexora/domain-projects';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The window the review looks back over. */
export const REVIEW_DAYS = 7;
/** Waiting at one step this long (or longer) counts as stuck. */
export const STUCK_AFTER_HOURS = 48;

export interface ReviewWaitingStep {
  /** The step's name ("Finance approves"). */
  step: string;
  /** The departments whose requests wait there ("Finance, People"). */
  department: string;
  /** How many requests are waiting at this step. */
  count: number;
  /** The longest any of them has waited, in hours. */
  longestHours: number;
}

export interface ReviewWaitingRequest {
  id: string;
  workflow: string;
  summary: string;
  step: string;
  requestedBy: string;
  waitingHours: number;
  stuck: boolean;
}

export interface ReviewDepartment {
  department: string;
  raised: number;
  finished: number;
  inMotion: number;
  /** Typical (median) hours from raised to finished; absent when none finished. */
  typicalHours?: number;
}

/** The counted facts of one week. */
export interface WeeklyReview {
  from: string;
  to: string;
  requests: {
    raised: number;
    finished: number;
    refused: number;
    withdrawn: number;
    /** Everything still waiting for someone, whenever it was raised. */
    inMotion: number;
    /** Typical (median) hours from raised to finished, for those finished in the window. */
    typicalHours?: number;
    /** How many of the requests raised in the window the assistant helped write. */
    draftedWithAssistant: number;
    /** How many times the assistant prepared someone for a decision or drafted their write-up. */
    assistantHelps: number;
  };
  waitingAt: readonly ReviewWaitingStep[];
  waitingLongest: readonly ReviewWaitingRequest[];
  departments: readonly ReviewDepartment[];
  tasks: { done: number; inReview: number; inProgress: number; todo: number; overdue: number };
}

const median = (values: readonly number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};
const hoursBetween = (from: string, to: string | Date): number =>
  Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / HOUR);
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** When the request arrived at the step it is waiting at. */
function arrivedAt(request: OfficeRequestSnapshot): string {
  const moves = request.history.filter(
    (entry) =>
      entry.action === 'submitted' ||
      entry.action === 'approved' ||
      entry.action === 'not_required',
  );
  return moves[moves.length - 1]?.at ?? request.createdAt;
}

/** Counts one week of the office from its records. */
export function buildWeeklyReview(
  input: {
    requests: readonly OfficeRequestSnapshot[];
    tasks: readonly ProjectTaskSnapshot[];
    summaryOf: (
      definition: WorkflowDefinition,
      details: OfficeRequestSnapshot['details'],
    ) => string;
  },
  now: Date = new Date(),
): WeeklyReview {
  const from = new Date(now.getTime() - REVIEW_DAYS * DAY);
  const inWindow = (iso: string): boolean => new Date(iso).getTime() >= from.getTime();
  const today = now.toISOString().slice(0, 10);

  const steps = new Map<string, ReviewWaitingStep>();
  const departments = new Map<string, ReviewDepartment & { times: number[] }>();
  const waiting: ReviewWaitingRequest[] = [];
  const finishedTimes: number[] = [];
  let raised = 0;
  let finished = 0;
  let refused = 0;
  let withdrawn = 0;
  let inMotion = 0;
  let drafted = 0;
  let helps = 0;

  for (const request of input.requests) {
    const definition = findWorkflow(request.details.type);
    const department = definition?.department ?? 'Other';
    const row = departments.get(department) ?? {
      department,
      raised: 0,
      finished: 0,
      inMotion: 0,
      times: [],
    };
    departments.set(department, row);

    if (inWindow(request.createdAt)) {
      raised += 1;
      row.raised += 1;
      const submitted = request.history.find((entry) => entry.action === 'submitted');
      if (
        request.history.some(
          (entry) =>
            entry.action === 'assisted' && entry.at <= (submitted?.at ?? request.createdAt),
        )
      ) {
        drafted += 1;
      }
    }
    helps += request.history.filter(
      (entry) => entry.action === 'assisted' && inWindow(entry.at),
    ).length;

    if (request.status === 'pending') {
      inMotion += 1;
      row.inMotion += 1;
      const stageKey = request.stages[request.stageIndex];
      const stage =
        definition === undefined || stageKey === undefined
          ? undefined
          : findWorkflowStage(definition, stageKey);
      const step = stage?.label ?? 'Next step';
      const waitingHours = hoursBetween(arrivedAt(request), now);
      // One row per step whatever the department: the same seat is the same queue.
      const at = steps.get(step) ?? { step, department, count: 0, longestHours: 0 };
      at.count += 1;
      at.longestHours = Math.max(at.longestHours, round1(waitingHours));
      if (!at.department.split(', ').includes(department)) {
        at.department = `${at.department}, ${department}`;
      }
      steps.set(step, at);
      waiting.push({
        id: request.id,
        workflow: definition?.name ?? request.details.type,
        summary: definition === undefined ? '' : input.summaryOf(definition, request.details),
        step,
        requestedBy: request.requestedBy,
        waitingHours: round1(waitingHours),
        stuck: waitingHours >= STUCK_AFTER_HOURS,
      });
    } else if (inWindow(request.updatedAt)) {
      if (request.status === 'approved') {
        finished += 1;
        row.finished += 1;
        const took = hoursBetween(request.createdAt, request.updatedAt);
        finishedTimes.push(took);
        row.times.push(took);
      } else if (request.status === 'rejected') {
        refused += 1;
      } else {
        withdrawn += 1;
      }
    }
  }

  const tasks = { done: 0, inReview: 0, inProgress: 0, todo: 0, overdue: 0 };
  for (const task of input.tasks) {
    if (task.status === 'done') {
      if (inWindow(task.updatedAt)) tasks.done += 1;
      continue;
    }
    if (task.status === 'in_review') tasks.inReview += 1;
    else if (task.status === 'in_progress') tasks.inProgress += 1;
    else tasks.todo += 1;
    if (task.dueDate !== undefined && task.dueDate < today) tasks.overdue += 1;
  }

  const typical = median(finishedTimes);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    requests: {
      raised,
      finished,
      refused,
      withdrawn,
      inMotion,
      ...(typical === undefined ? {} : { typicalHours: round1(typical) }),
      draftedWithAssistant: drafted,
      assistantHelps: helps,
    },
    waitingAt: [...steps.values()].sort(
      (a, b) => b.count - a.count || b.longestHours - a.longestHours,
    ),
    waitingLongest: waiting.sort((a, b) => b.waitingHours - a.waitingHours).slice(0, 8),
    departments: [...departments.values()]
      .map(({ times, ...row }) => {
        const typicalHours = median(times);
        return {
          ...row,
          ...(typicalHours === undefined ? {} : { typicalHours: round1(typicalHours) }),
        };
      })
      .filter((row) => row.raised + row.finished + row.inMotion > 0)
      .sort((a, b) => b.inMotion - a.inMotion || b.raised - a.raised),
    tasks,
  };
}

/** "3 hours", "2 days" — how a person says a length of time. */
export function spokenHours(hours: number): string {
  if (hours < 1) return 'less than an hour';
  if (hours < 36) {
    const whole = Math.round(hours);
    return `${whole} ${whole === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The review in a few plain sentences, straight from the counts (no model). */
export function reviewByRules(review: WeeklyReview): string {
  const { requests, waitingAt, waitingLongest, tasks } = review;
  const sentences: string[] = [];
  sentences.push(
    `${requests.raised} ${requests.raised === 1 ? 'request was' : 'requests were'} raised this week and ${requests.finished} ${requests.finished === 1 ? 'was' : 'were'} finished${
      requests.typicalHours === undefined
        ? ''
        : `, typically in ${spokenHours(requests.typicalHours)}`
    }.`,
  );
  const busiest = waitingAt[0];
  if (busiest === undefined) {
    sentences.push('Nothing is waiting for anyone right now.');
  } else {
    sentences.push(
      `${requests.inMotion} ${requests.inMotion === 1 ? 'is' : 'are'} still in motion; most are waiting at “${busiest.step}” (${busiest.count}, the longest for ${spokenHours(busiest.longestHours)}).`,
    );
  }
  const stuck = waitingLongest.filter((item) => item.stuck).length;
  if (stuck > 0) {
    sentences.push(
      `${stuck} ${stuck === 1 ? 'has' : 'have'} waited two days or more at one step and ${stuck === 1 ? 'needs' : 'need'} a nudge.`,
    );
  }
  if (tasks.overdue > 0) {
    sentences.push(
      `${tasks.overdue} project ${tasks.overdue === 1 ? 'task is' : 'tasks are'} past the due date.`,
    );
  }
  return sentences.join(' ');
}
