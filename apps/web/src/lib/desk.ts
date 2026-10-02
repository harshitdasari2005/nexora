/**
 * @nexora/app-web — the desk: what is waiting for the person signed in.
 *
 * The desk asks the backend the same questions the hiring, recruiting,
 * onboarding, requests and tasks pages ask — with the caller's own session — and keeps the items
 * the server says THIS person may act on right now (`actions.canDecide`,
 * `canComplete`, …). It decides nothing itself: an item is on your desk only
 * because the server said the next move is yours.
 */

import { ApiError } from './api.js';
import { listRequisitions, statusLabel, type HiringScope, type Requisition } from './hiring.js';
import { listOnboardings, type OnboardingRecord, type ReadyHire } from './onboarding.js';
import { listRequests, requestStatusLabel, requestTitle, type OfficeRequest } from './requests.js';
import { listTasks, TASK_STATUS_LABEL, type ProjectTask } from './tasks.js';
import {
  getOpening,
  listOpenings,
  STAGE_LABEL,
  type Candidate,
  type Opening,
  type ReadyRequisition,
} from './recruiting.js';

/** The page an item is handled on. */
export type DeskScreen = 'hiring' | 'recruiting' | 'onboarding' | 'requests' | 'tasks';

/** One thing on the desk. */
export interface DeskItem {
  id: string;
  screen: DeskScreen;
  /** What to do (for `mine`) or what is happening (for `watching`). */
  title: string;
  /** One line of context. */
  detail: string;
}

/** What the desk is built from (each part read with the caller's session). */
export interface DeskSources {
  requisitions: readonly Requisition[];
  /** The caller may raise a hiring request. */
  canRaiseRequest: boolean;
  readyRequisitions: readonly ReadyRequisition[];
  canManageRecruiting: boolean;
  openings: readonly (Opening & { candidates: readonly Candidate[] })[];
  readyHires: readonly ReadyHire[];
  canStartOnboarding: boolean;
  onboardings: readonly OnboardingRecord[];
  /** Office requests the caller takes part in (leave, purchase, IT access). */
  officeRequests: readonly OfficeRequest[];
  canRaiseOfficeRequest: boolean;
  /** Project tasks the caller can see. */
  tasks: readonly ProjectTask[];
  canManageTasks: boolean;
}

/** The desk: what is yours to do, and what is moving without you. */
export interface Desk {
  mine: readonly DeskItem[];
  watching: readonly DeskItem[];
  /** Work this person can begin themselves. */
  starts: readonly DeskItem[];
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** Sorts what the server returned into "yours to do" and "in motion". */
export function buildDesk(sources: DeskSources): Desk {
  const mine: DeskItem[] = [];
  const watching: DeskItem[] = [];

  for (const requisition of sources.requisitions) {
    const raisedBy = requisition.requestedByName ?? 'a colleague';
    if (requisition.actions.canDecide) {
      mine.push({
        id: `decide-${requisition.id}`,
        screen: 'hiring',
        title: `Decide on the request for a ${requisition.jobTitle}`,
        detail: `Raised by ${raisedBy} for ${requisition.department}.`,
      });
    } else if (requisition.actions.canRevise) {
      const reason = [...requisition.history]
        .reverse()
        .find((entry) => entry.action === 'rejected')?.comment;
      mine.push({
        id: `revise-${requisition.id}`,
        screen: 'hiring',
        title: `Revise the request for a ${requisition.jobTitle}`,
        detail: reason === undefined ? 'It was sent back to you.' : `It was sent back: “${reason}”`,
      });
    } else if (
      requisition.status === 'pending_executive' ||
      requisition.status === 'pending_finance'
    ) {
      watching.push({
        id: `pending-${requisition.id}`,
        screen: 'hiring',
        title: `Request for a ${requisition.jobTitle}`,
        detail: `${statusLabel(requisition.status)}. Raised by ${raisedBy}.`,
      });
    }
  }

  if (sources.canManageRecruiting) {
    for (const ready of sources.readyRequisitions) {
      mine.push({
        id: `open-${ready.id}`,
        screen: 'recruiting',
        title: `Open the position for a ${ready.jobTitle}`,
        detail: `Approved by the CEO and Finance. Raised by ${ready.requestedByName ?? 'a manager'}.`,
      });
    }
  }

  for (const opening of sources.openings) {
    if (opening.status !== 'open') continue;
    const live = opening.candidates.filter(
      (candidate) => candidate.stage !== 'rejected' && candidate.stage !== 'withdrawn',
    );
    if (opening.canManage && live.length === 0) {
      mine.push({
        id: `candidates-${opening.id}`,
        screen: 'recruiting',
        title: `Add candidates for the ${opening.title} position`,
        detail: 'The position is open and nobody has applied yet.',
      });
    }
    for (const candidate of live) {
      const { actions } = candidate;
      const reviewed = candidate.feedback.length > 0;
      if (actions.canRecordResponse) {
        mine.push({
          id: `answer-${candidate.id}`,
          screen: 'recruiting',
          title: `Record ${candidate.name}'s answer to the offer`,
          detail: `Offer made for the ${opening.title} position.`,
        });
      } else if (actions.canOffer && reviewed) {
        mine.push({
          id: `offer-${candidate.id}`,
          screen: 'recruiting',
          title: `Make ${candidate.name} an offer`,
          detail: `Interviewed for the ${opening.title} position, with feedback.`,
        });
      } else if (actions.canGiveFeedback && candidate.stage === 'interview' && !reviewed) {
        mine.push({
          id: `feedback-${candidate.id}`,
          screen: 'recruiting',
          title: `Give interview feedback on ${candidate.name}`,
          detail: `Candidate for the ${opening.title} position.`,
        });
      } else if (actions.canAdvance && candidate.nextStage !== undefined) {
        mine.push({
          id: `advance-${candidate.id}`,
          screen: 'recruiting',
          title: `Move ${candidate.name} on to ${STAGE_LABEL[candidate.nextStage].toLowerCase()}`,
          detail: `Now at ${STAGE_LABEL[candidate.stage].toLowerCase()} for the ${opening.title} position.`,
        });
      } else {
        watching.push({
          id: `candidate-${candidate.id}`,
          screen: 'recruiting',
          title: `${candidate.name}, candidate for ${opening.title}`,
          detail: `At ${STAGE_LABEL[candidate.stage].toLowerCase()}.`,
        });
      }
    }
  }

  if (sources.canStartOnboarding) {
    for (const hire of sources.readyHires) {
      mine.push({
        id: `start-${hire.employeeId}`,
        screen: 'onboarding',
        title: `Start ${hire.name}'s onboarding`,
        detail: `Hired${hire.jobTitle === undefined ? '' : ` as ${hire.jobTitle}`}; onboarding has not started.`,
      });
    }
  }

  for (const record of sources.onboardings) {
    const myItems = record.items.filter((item) => item.canComplete);
    const open = record.items.filter((item) => !item.done);
    if (myItems.length > 0) {
      mine.push({
        id: `items-${record.id}`,
        screen: 'onboarding',
        title: `Do your part of ${record.employeeName}'s onboarding`,
        detail: `${plural(myItems.length, 'item is', 'items are')} waiting for you: ${myItems
          .map((item) => item.title.toLowerCase())
          .join('; ')}.`,
      });
    } else if (
      record.status === 'completed' &&
      record.canAssign &&
      !record.assignedToProject &&
      record.projectName !== undefined
    ) {
      mine.push({
        id: `assign-${record.id}`,
        screen: 'onboarding',
        title: `Assign ${record.employeeName} to ${record.projectName}`,
        detail: 'Onboarding is complete and they are not on a project yet.',
      });
    } else if (record.status === 'in_progress') {
      watching.push({
        id: `onboarding-${record.id}`,
        screen: 'onboarding',
        title: `${record.employeeName}'s onboarding`,
        detail: `${plural(open.length, 'item', 'items')} still open with other people.`,
      });
    }
  }

  for (const request of sources.officeRequests) {
    if (request.actions.canDecide && request.pending !== undefined) {
      mine.push({
        id: `request-${request.id}`,
        screen: 'requests',
        title: `${request.pending.label}: ${requestTitle(request)}`,
        detail: request.mine
          ? `${request.department}. Started by you.`
          : `${request.department}. Started by ${request.requestedByName ?? 'a colleague'}.`,
      });
    } else if (request.mine && request.status === 'pending') {
      watching.push({
        id: `request-${request.id}`,
        screen: 'requests',
        title: requestTitle(request),
        detail: `${requestStatusLabel(request)}.`,
      });
    }
  }

  for (const task of sources.tasks) {
    const project = task.projectName ?? 'the project';
    if (task.actions.canReview) {
      mine.push({
        id: `review-${task.id}`,
        screen: 'tasks',
        title: `Review “${task.title}”`,
        detail: `Handed in by ${task.assigneeName ?? 'the assignee'} on ${project}.`,
      });
    } else if (task.actions.canStart) {
      mine.push({
        id: `start-${task.id}`,
        screen: 'tasks',
        title: `Start “${task.title}”`,
        detail: `Given to you by ${task.createdByName ?? 'your manager'} on ${project}.`,
      });
    } else if (task.actions.canSubmit) {
      mine.push({
        id: `finish-${task.id}`,
        screen: 'tasks',
        title: `Finish “${task.title}” and hand it in`,
        detail: `In progress on ${project}.`,
      });
    } else if (task.status !== 'done') {
      watching.push({
        id: `task-${task.id}`,
        screen: 'tasks',
        title: `“${task.title}”`,
        detail: `${TASK_STATUS_LABEL[task.status]}, with ${task.mine ? 'you' : (task.assigneeName ?? 'someone')}.`,
      });
    }
  }

  const starts: DeskItem[] = [];
  if (sources.canRaiseOfficeRequest) {
    starts.push({
      id: 'request',
      screen: 'requests',
      title: 'Start an office workflow',
      detail:
        'Leave, purchases, campaigns, bugs, contracts and more — each goes to the right people.',
    });
  }
  if (sources.canManageTasks) {
    starts.push({
      id: 'task',
      screen: 'tasks',
      title: 'Give someone a task',
      detail: 'Create a task on a project and choose who does it.',
    });
  }
  if (sources.canRaiseRequest) {
    starts.push({
      id: 'raise',
      screen: 'hiring',
      title: 'Ask for a new hire',
      detail: 'Raise a hiring request. It goes to the CEO, then to Finance, then to HR.',
    });
  }
  return { mine, watching, starts };
}

/** A read the caller's role is not allowed to make simply contributes nothing. */
async function allowed<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return fallback;
    }
    throw error;
  }
}

/** Reads everything the desk is built from, with the caller's own session. */
export async function loadDesk(scope: HiringScope): Promise<Desk> {
  const [hiring, recruiting, onboarding, requests, tasks] = await Promise.all([
    allowed(listRequisitions(scope), { requisitions: [], canCreate: false }),
    allowed(listOpenings(scope), { openings: [], readyRequisitions: [], canManage: false }),
    allowed(listOnboardings(scope), { onboardings: [], readyToStart: [], canStart: false }),
    allowed(listRequests(scope), { requests: [], canCreate: false }),
    allowed(listTasks(scope), { tasks: [], canManage: false, assignees: [], projects: [] }),
  ]);
  const openings = await Promise.all(
    recruiting.openings.map(async (opening) => ({
      ...opening,
      candidates:
        opening.status === 'open'
          ? (await allowed(getOpening(scope, opening.id), { opening, candidates: [] })).candidates
          : [],
    })),
  );
  return buildDesk({
    requisitions: hiring.requisitions,
    canRaiseRequest: hiring.canCreate,
    readyRequisitions: recruiting.readyRequisitions,
    canManageRecruiting: recruiting.canManage,
    openings,
    readyHires: onboarding.readyToStart,
    canStartOnboarding: onboarding.canStart,
    onboardings: onboarding.onboardings,
    officeRequests: requests.requests,
    canRaiseOfficeRequest: requests.canCreate,
    tasks: tasks.tasks,
    canManageTasks: tasks.canManage,
  });
}
