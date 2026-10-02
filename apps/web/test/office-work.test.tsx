/**
 * Requests and Tasks pages, and their place on My desk: a button appears only
 * where the server said the caller may act; what is asked and where it stands
 * are shown in plain words.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { buildDesk, type DeskSources } from '../src/lib/desk.js';
import {
  requestRoute,
  requestStatusLabel,
  requestSummary,
  type OfficeRequest,
} from '../src/lib/requests.js';
import { projectProgress, type ProjectTask, type TaskBoard } from '../src/lib/tasks.js';
import { historyLine, RequestsView, validateRequest } from '../src/pages/Requests.js';
import { TasksView } from '../src/pages/Tasks.js';

const scope = { organizationId: 'org_1', workspaceId: 'wsp_eng' };
const render = (node: JSX.Element): string =>
  renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '');

function request(overrides: Partial<OfficeRequest> = {}): OfficeRequest {
  return {
    id: 'ofr_1',
    type: 'leave',
    details: {
      type: 'leave',
      kind: 'vacation',
      startDate: '2026-11-10',
      endDate: '2026-11-14',
      reason: 'Family wedding.',
    },
    status: 'pending',
    pendingStage: 'manager',
    stages: [
      { stage: 'manager', state: 'current' },
      { stage: 'hr', state: 'waiting' },
    ],
    requestedBy: 'usr_dev',
    requestedByName: 'Aarav Kulkarni',
    mine: false,
    history: [{ at: '2026-10-02T09:00:00.000Z', actorId: 'usr_dev', action: 'submitted' }],
    createdAt: '2026-10-02T09:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
    actions: { canDecide: false, canWithdraw: false },
    ...overrides,
  };
}

function task(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: 'task_1',
    projectId: 'prj_1',
    projectName: 'Mobile Banking Platform',
    title: 'Build the login screen',
    priority: 'high',
    dueDate: '2026-11-20',
    status: 'todo',
    assigneeId: 'usr_dev',
    assigneeName: 'Aarav Kulkarni',
    createdByName: 'Rohan Mehta',
    mine: false,
    history: [{ at: '2026-10-02T09:00:00.000Z', actorName: 'Rohan Mehta', action: 'created' }],
    createdAt: '2026-10-02T09:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
    actions: { canStart: false, canSubmit: false, canReview: false, canReassign: false },
    ...overrides,
  };
}

const board = (tasks: ProjectTask[], overrides: Partial<TaskBoard> = {}): TaskBoard => ({
  tasks,
  canManage: false,
  assignees: [],
  projects: [],
  ...overrides,
});

describe('requests in plain words', () => {
  it('says what is asked for, by kind', () => {
    expect(requestSummary(request().details)).toBe('10 Nov to 14 Nov, vacation');
    expect(
      requestSummary({
        type: 'leave',
        kind: 'sick',
        startDate: '2026-11-10',
        endDate: '2026-11-10',
        reason: 'Flu.',
      }),
    ).toBe('10 Nov, sick leave');
    expect(
      requestSummary({
        type: 'purchase',
        item: 'Test devices',
        amountMinorUnits: 4_500_000,
        currency: 'INR',
        reason: 'Device lab.',
      }),
    ).toBe('Test devices, ₹45,000');
    expect(requestSummary({ type: 'access', what: 'VPN', reason: 'Remote work.' })).toBe('VPN');
  });

  it('says where it stands and draws its route', () => {
    expect(requestStatusLabel(request())).toBe('Waiting for Manager');
    expect(requestStatusLabel(request({ status: 'approved', pendingStage: undefined }))).toBe(
      'Approved',
    );
    expect(requestRoute(request())).toEqual([
      { label: 'Raised', state: 'done' },
      { label: 'Manager', state: 'current' },
      { label: 'HR', state: 'waiting' },
    ]);
    expect(
      historyLine({
        at: 't',
        actorId: 'u',
        actorName: 'Rohan Mehta',
        action: 'rejected',
        stage: 'manager',
        comment: 'Not this sprint.',
      }),
    ).toBe('Rohan Mehta rejected it (Manager) — “Not this sprint.”');
  });

  it('checks a new request before it is sent', () => {
    const base = {
      type: 'leave' as const,
      startDate: '',
      endDate: '',
      item: '',
      amount: '',
      what: '',
      reason: 'Family wedding.',
    };
    expect(validateRequest(base)).toBe('Choose the first and last day.');
    expect(validateRequest({ ...base, startDate: '2026-11-10', endDate: '2026-11-01' })).toBe(
      'The last day cannot be before the first day.',
    );
    expect(validateRequest({ ...base, type: 'purchase', item: 'Phones', amount: '0' })).toBe(
      'Enter what it costs.',
    );
    expect(validateRequest({ ...base, type: 'access', what: 'VPN', reason: 'pls' })).toBe(
      'Say why you are asking (a few words).',
    );
    expect(validateRequest({ ...base, startDate: '2026-11-10', endDate: '2026-11-14' })).toBeNull();
  });
});

describe('RequestsView', () => {
  it('invites a first request when there are none', () => {
    const html = render(
      <RequestsView scope={scope} requests={[]} canCreate onChanged={() => undefined} />,
    );
    expect(html).toContain('No requests yet');
    expect(html).toContain('New request');
  });

  it('puts requests waiting for the caller first, with Approve and Reject — and only there', () => {
    const html = render(
      <RequestsView
        scope={scope}
        canCreate
        onChanged={() => undefined}
        requests={[
          request({
            id: 'ofr_mine',
            mine: true,
            requestedByName: 'Rohan Mehta',
            actions: { canDecide: false, canWithdraw: true },
          }),
          request({ id: 'ofr_decide', actions: { canDecide: true, canWithdraw: false } }),
        ]}
      />,
    );
    expect(html.indexOf('Waiting for your decision')).toBeLessThan(html.indexOf('Your requests'));
    expect(html.match(/>Approve</g)).toHaveLength(1);
    expect(html.match(/>Reject</g)).toHaveLength(1);
    expect(html.match(/>Withdraw</g)).toHaveLength(1);
    expect(html).toContain('Raised by Aarav Kulkarni.');
    expect(html).toContain('Raised by you.');
    expect(html).toContain('Your decision');
  });

  it('shows a rejection with its reason, and no buttons to decide', () => {
    const html = render(
      <RequestsView
        scope={scope}
        canCreate={false}
        onChanged={() => undefined}
        requests={[
          request({
            mine: true,
            status: 'rejected',
            pendingStage: undefined,
            stages: [
              { stage: 'manager', state: 'returned' },
              { stage: 'hr', state: 'waiting' },
            ],
            history: [
              { at: 't1', actorId: 'u', action: 'submitted' },
              {
                at: 't2',
                actorId: 'm',
                actorName: 'Rohan Mehta',
                action: 'rejected',
                stage: 'manager',
                comment: 'Release week.',
              },
            ],
          }),
        ]}
      />,
    );
    expect(html).toContain('Rejected by Rohan Mehta: “Release week.”');
    expect(html).not.toContain('>Approve<');
    expect(html).not.toContain('New request');
  });
});

describe('TasksView', () => {
  it('a developer sees their own task with the one step that is theirs', () => {
    const html = render(
      <TasksView
        scope={scope}
        onChanged={() => undefined}
        board={board([
          task({
            mine: true,
            actions: { canStart: true, canSubmit: false, canReview: false, canReassign: false },
          }),
        ])}
      />,
    );
    expect(html).toContain('Build the login screen');
    expect(html).toContain('>Start<');
    expect(html).toContain('Your task');
    expect(html).not.toContain('New task');
    expect(html).not.toContain('>Accept<');
    expect(html).not.toContain('Project progress');
  });

  it('a manager sees the board, the progress and the review buttons where work was handed in', () => {
    const html = render(
      <TasksView
        scope={scope}
        onChanged={() => undefined}
        board={board(
          [
            task({ id: 'task_a', status: 'done' }),
            task({
              id: 'task_b',
              title: 'Write the API client',
              status: 'in_review',
              actions: { canStart: false, canSubmit: false, canReview: true, canReassign: true },
            }),
            task({
              id: 'task_c',
              title: 'Set up CI',
              status: 'in_progress',
              actions: { canStart: false, canSubmit: false, canReview: false, canReassign: true },
            }),
          ],
          {
            canManage: true,
            assignees: [{ userId: 'usr_m', name: 'Meghna Iyer' }],
            projects: [{ id: 'prj_1', name: 'Mobile Banking Platform' }],
          },
        )}
      />,
    );
    expect(html).toContain('New task');
    expect(html).toContain('1 of 3 tasks done');
    for (const column of ['To do', 'In progress', 'In review', 'Done'])
      expect(html).toContain(column);
    expect(html.match(/>Accept</g)).toHaveLength(1);
    expect(html.match(/>Send back</g)).toHaveLength(1);
    expect(html.match(/>Reassign</g)).toHaveLength(2);
    expect(html).toContain('with Aarav Kulkarni');
  });

  it('shows why work was sent back to the person it went back to', () => {
    const html = render(
      <TasksView
        scope={scope}
        onChanged={() => undefined}
        board={board([
          task({
            mine: true,
            status: 'in_progress',
            actions: { canStart: false, canSubmit: true, canReview: false, canReassign: false },
            history: [
              { at: 't1', actorName: 'Rohan Mehta', action: 'created' },
              {
                at: 't2',
                actorName: 'Rohan Mehta',
                action: 'sent_back',
                comment: 'Add error states.',
              },
            ],
          }),
        ])}
      />,
    );
    expect(html).toContain('Sent back by Rohan Mehta: “Add error states.”');
    expect(html).toContain('>Hand in<');
  });

  it('counts progress per project', () => {
    expect(
      projectProgress([
        { projectId: 'a', projectName: 'A', status: 'done' },
        { projectId: 'a', projectName: 'A', status: 'todo' },
        { projectId: 'b', projectName: 'B', status: 'done' },
      ]),
    ).toEqual([
      { projectId: 'a', name: 'A', done: 1, total: 2 },
      { projectId: 'b', name: 'B', done: 1, total: 1 },
    ]);
  });
});

describe('requests and tasks on My desk', () => {
  const sources = (overrides: Partial<DeskSources> = {}): DeskSources => ({
    requisitions: [],
    canRaiseRequest: false,
    readyRequisitions: [],
    canManageRecruiting: false,
    openings: [],
    readyHires: [],
    canStartOnboarding: false,
    onboardings: [],
    officeRequests: [],
    canRaiseOfficeRequest: false,
    tasks: [],
    canManageTasks: false,
    ...overrides,
  });

  it('a request to decide is yours; your own pending request is in motion', () => {
    const desk = buildDesk(
      sources({
        officeRequests: [
          request({ id: 'ofr_a', actions: { canDecide: true, canWithdraw: false } }),
          request({ id: 'ofr_b', mine: true }),
          request({ id: 'ofr_c', mine: true, status: 'approved', pendingStage: undefined }),
          request({ id: 'ofr_d' }),
        ],
      }),
    );
    expect(desk.mine).toMatchObject([
      { title: "Decide on Aarav Kulkarni's leave request", screen: 'requests' },
    ]);
    expect(desk.watching).toMatchObject([
      { title: 'Your leave request', detail: '10 Nov to 14 Nov, vacation. Waiting for Manager.' },
    ]);
  });

  it('a task is yours to start, to finish or to review — otherwise it is in motion', () => {
    const none = { canStart: false, canSubmit: false, canReview: false, canReassign: false };
    const desk = buildDesk(
      sources({
        tasks: [
          task({ id: 't1', mine: true, actions: { ...none, canStart: true } }),
          task({
            id: 't2',
            mine: true,
            status: 'in_progress',
            actions: { ...none, canSubmit: true },
          }),
          task({ id: 't3', status: 'in_review', actions: { ...none, canReview: true } }),
          task({ id: 't4', status: 'in_progress', actions: { ...none, canReassign: true } }),
          task({ id: 't5', status: 'done' }),
        ],
      }),
    );
    expect(desk.mine.map((item) => item.title)).toEqual([
      'Start “Build the login screen”',
      'Finish “Build the login screen” and hand it in',
      'Review “Build the login screen”',
    ]);
    expect(desk.watching).toMatchObject([{ detail: 'In progress, with Aarav Kulkarni.' }]);
  });

  it('offers to start only what the caller may start', () => {
    expect(buildDesk(sources()).starts).toEqual([]);
    expect(
      buildDesk(sources({ canRaiseOfficeRequest: true, canManageTasks: true })).starts.map(
        (item) => item.screen,
      ),
    ).toEqual(['requests', 'tasks']);
  });
});
