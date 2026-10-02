/**
 * My desk: what the server says is the caller's to do is on the desk; what is
 * moving with other people is listed apart; nothing else is invented.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { buildDesk, type DeskSources } from '../src/lib/desk.js';
import type { Requisition } from '../src/lib/hiring.js';
import type { OnboardingRecord } from '../src/lib/onboarding.js';
import type { Candidate, Opening } from '../src/lib/recruiting.js';
import { DeskView } from '../src/pages/Desk.js';

const NO_ACTIONS = { canDecide: false, canRevise: false, canWithdraw: false };

function requisition(overrides: Partial<Requisition> = {}): Requisition {
  return {
    id: 'req_1',
    organizationId: 'org_1',
    workspaceId: 'wsp_eng',
    requestedBy: 'usr_manager',
    requestedByName: 'Rohan Mehta',
    jobTitle: 'Senior Backend Developer',
    department: 'Engineering Delivery',
    headcount: 1,
    employmentType: 'full_time',
    salaryMinMinorUnits: 180_000_000,
    salaryMaxMinorUnits: 240_000_000,
    currency: 'INR',
    justification: 'The rebuild needs another engineer.',
    urgency: 'high',
    status: 'pending_executive',
    round: 1,
    history: [],
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    actions: NO_ACTIONS,
    ...overrides,
  };
}

const NO_CANDIDATE_ACTIONS = {
  canAdvance: false,
  canGiveFeedback: false,
  canOffer: false,
  canRecordResponse: false,
  canClose: false,
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'cand_1',
    openingId: 'job_1',
    name: 'Sarah Thomas',
    email: 'sarah.thomas@example.com',
    source: 'referral',
    stage: 'interview',
    feedback: [],
    history: [],
    actions: NO_CANDIDATE_ACTIONS,
    ...overrides,
  };
}

function opening(
  candidates: readonly Candidate[],
  overrides: Partial<Opening> = {},
): Opening & { candidates: readonly Candidate[] } {
  return {
    id: 'job_1',
    requisitionId: 'req_1',
    title: 'Senior Backend Developer',
    department: 'Engineering Delivery',
    headcount: 1,
    employmentType: 'full_time',
    salaryMinMinorUnits: 180_000_000,
    salaryMaxMinorUnits: 240_000_000,
    currency: 'INR',
    description: 'Build the banking backend.',
    status: 'open',
    offersOut: 0,
    hiredCount: 0,
    seatsAvailable: 1,
    canManage: false,
    createdAt: '2026-10-01T09:00:00.000Z',
    candidates,
    ...overrides,
  };
}

function onboarding(overrides: Partial<OnboardingRecord> = {}): OnboardingRecord {
  return {
    id: 'onb_1',
    employeeId: 'emp_1',
    employeeName: 'Sarah Thomas',
    status: 'in_progress',
    assignedToProject: false,
    canAssign: false,
    items: [
      {
        key: 'paperwork',
        owner: 'hr',
        title: 'Contract and paperwork signed',
        done: true,
        canComplete: false,
      },
      {
        key: 'accounts',
        owner: 'it',
        title: 'Email and system accounts created',
        done: false,
        canComplete: false,
      },
      {
        key: 'equipment',
        owner: 'it',
        title: 'Laptop and equipment ready',
        done: false,
        canComplete: false,
      },
    ],
    ...overrides,
  };
}

const sources = (overrides: Partial<DeskSources> = {}): DeskSources => ({
  requisitions: [],
  canRaiseRequest: false,
  readyRequisitions: [],
  canManageRecruiting: false,
  openings: [],
  readyHires: [],
  canStartOnboarding: false,
  onboardings: [],
  ...overrides,
});

const titles = (items: readonly { title: string }[]): string[] => items.map((item) => item.title);

describe('buildDesk', () => {
  it('is empty when the server offers nothing', () => {
    expect(buildDesk(sources())).toEqual({ mine: [], watching: [], starts: [] });
  });

  it('offers to raise a request only to someone who may', () => {
    expect(buildDesk(sources({ canRaiseRequest: true })).starts).toMatchObject([
      { title: 'Ask for a new hire', screen: 'hiring' },
    ]);
    expect(buildDesk(sources()).starts).toEqual([]);
  });

  it('puts a request on the desk of the person whose decision it is — and only theirs', () => {
    const decider = buildDesk(
      sources({ requisitions: [requisition({ actions: { ...NO_ACTIONS, canDecide: true } })] }),
    );
    expect(titles(decider.mine)).toEqual(['Decide on the request for a Senior Backend Developer']);
    expect(decider.watching).toEqual([]);

    const onlooker = buildDesk(sources({ requisitions: [requisition()] }));
    expect(onlooker.mine).toEqual([]);
    expect(onlooker.watching[0]?.detail).toBe('Waiting for the CEO. Raised by Rohan Mehta.');
  });

  it('brings a rejected request back to its requester, with the reason', () => {
    const desk = buildDesk(
      sources({
        requisitions: [
          requisition({
            status: 'changes_requested',
            actions: { ...NO_ACTIONS, canRevise: true },
            history: [
              { at: 't1', actorId: 'u', action: 'submitted', round: 1 },
              {
                at: 't2',
                actorId: 'c',
                action: 'rejected',
                stage: 'executive',
                comment: 'Say which project.',
                round: 1,
              },
            ],
          }),
        ],
      }),
    );
    expect(desk.mine[0]).toMatchObject({
      title: 'Revise the request for a Senior Backend Developer',
      detail: 'It was sent back: “Say which project.”',
      screen: 'hiring',
    });
  });

  it('shows approved requests to HR only', () => {
    const ready = [
      {
        id: 'req_2',
        jobTitle: 'QA Engineer',
        department: 'Engineering Delivery',
        headcount: 1,
        employmentType: 'full_time',
        salaryMinMinorUnits: 1,
        salaryMaxMinorUnits: 2,
        currency: 'INR',
        justification: 'Testing.',
        requestedByName: 'Rohan Mehta',
      },
    ];
    const hr = buildDesk(sources({ readyRequisitions: ready, canManageRecruiting: true }));
    expect(titles(hr.mine)).toEqual(['Open the position for a QA Engineer']);
    expect(buildDesk(sources({ readyRequisitions: ready })).mine).toEqual([]);
  });

  it('asks the interviewer for feedback once, then asks HR for the offer', () => {
    const interviewer = buildDesk(
      sources({
        openings: [
          opening([candidate({ actions: { ...NO_CANDIDATE_ACTIONS, canGiveFeedback: true } })]),
        ],
      }),
    );
    expect(titles(interviewer.mine)).toEqual(['Give interview feedback on Sarah Thomas']);

    const feedback = [
      {
        by: 'u',
        at: 't',
        stage: 'interview',
        rating: 5,
        recommendation: 'yes' as const,
        notes: 'Good.',
      },
    ];
    const afterFeedback = buildDesk(
      sources({
        openings: [
          opening([
            candidate({ feedback, actions: { ...NO_CANDIDATE_ACTIONS, canGiveFeedback: true } }),
          ]),
        ],
      }),
    );
    expect(afterFeedback.mine).toEqual([]);
    expect(titles(afterFeedback.watching)).toEqual([
      'Sarah Thomas, candidate for Senior Backend Developer',
    ]);

    const hr = buildDesk(
      sources({
        openings: [
          opening([candidate({ feedback, actions: { ...NO_CANDIDATE_ACTIONS, canOffer: true } })], {
            canManage: true,
          }),
        ],
      }),
    );
    expect(titles(hr.mine)).toEqual(['Make Sarah Thomas an offer']);
  });

  it('tells HR an open position has nobody yet, and ignores positions that are not open', () => {
    const empty = buildDesk(sources({ openings: [opening([], { canManage: true })] }));
    expect(titles(empty.mine)).toEqual([
      'Add candidates for the Senior Backend Developer position',
    ]);
    const filled = buildDesk(
      sources({ openings: [opening([], { canManage: true, status: 'filled' })] }),
    );
    expect(filled).toEqual({ mine: [], watching: [], starts: [] });
  });

  it('gives each person only their own onboarding items', () => {
    const it_ = buildDesk(
      sources({
        onboardings: [
          onboarding({
            items: onboarding().items.map((item) => ({
              ...item,
              canComplete: item.owner === 'it',
            })),
          }),
        ],
      }),
    );
    expect(it_.mine[0]?.title).toBe("Do your part of Sarah Thomas's onboarding");
    expect(it_.mine[0]?.detail).toContain('2 items are waiting for you');

    const hr = buildDesk(sources({ onboardings: [onboarding()] }));
    expect(hr.mine).toEqual([]);
    expect(hr.watching[0]?.detail).toBe('2 items still open with other people.');
  });

  it('asks the hiring manager to assign once onboarding is complete — never before, never twice', () => {
    const complete = {
      status: 'completed' as const,
      canAssign: true,
      projectName: 'Mobile Banking Platform',
    };
    expect(titles(buildDesk(sources({ onboardings: [onboarding(complete)] })).mine)).toEqual([
      'Assign Sarah Thomas to Mobile Banking Platform',
    ]);
    expect(
      buildDesk(sources({ onboardings: [onboarding({ ...complete, assignedToProject: true })] })),
    ).toEqual({ mine: [], watching: [], starts: [] });
    expect(
      buildDesk(sources({ onboardings: [onboarding({ ...complete, canAssign: false })] })).mine,
    ).toEqual([]);
  });
});

describe('DeskView', () => {
  const scope = { organizationId: 'org_1', workspaceId: 'wsp_eng' };
  const render = (node: JSX.Element): string =>
    renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '');

  it('says so while the desk is being read', () => {
    const html = render(<DeskView scope={scope} firstName="Rohan" desk={null} />);
    expect(html).toContain('Rohan&#x27;s desk');
    expect(html).toContain('Reading your desk');
    expect(html).not.toContain('Nothing is waiting for you');
  });

  it('shows an empty desk as empty', () => {
    const html = render(
      <DeskView scope={scope} firstName="Rohan" desk={{ mine: [], watching: [], starts: [] }} />,
    );
    expect(html).toContain('Nothing is waiting for you');
    expect(html).not.toContain('In motion');
  });

  it('links every item to the page it is done on, inside the caller’s scope', () => {
    const html = render(
      <DeskView
        scope={scope}
        firstName="Rohan"
        desk={{
          mine: [
            {
              id: 'a',
              screen: 'recruiting',
              title: 'Give interview feedback on Sarah Thomas',
              detail: 'Candidate.',
            },
          ],
          watching: [
            {
              id: 'b',
              screen: 'hiring',
              title: 'Request for a QA Engineer',
              detail: 'Waiting for Finance.',
            },
          ],
          starts: [],
        }}
      />,
    );
    expect(html).toContain('Give interview feedback on Sarah Thomas');
    expect(html).toContain('href="/app/recruiting?organizationId=org_1&amp;workspaceId=wsp_eng"');
    expect(html).toContain('In motion');
    expect(html).toContain('href="/app/hiring?organizationId=org_1&amp;workspaceId=wsp_eng"');
  });

  it('shows a failure as a failure', () => {
    const html = render(
      <DeskView scope={scope} firstName="Rohan" desk={null} error="Could not load your desk." />,
    );
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('Reading your desk');
  });
});
