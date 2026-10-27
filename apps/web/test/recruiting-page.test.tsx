/**
 * Recruiting page: HR sees approved requests to open, positions with their
 * seats, and candidates — and each button renders only when the SERVER says the
 * caller may take that step. Pay is shown only when the server sent it.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { recruitingProgress } from '../src/lib/hiring.js';
import { isModuleVisible } from '../src/lib/modules.js';
import { seatSummary, type Candidate, type Opening } from '../src/lib/recruiting.js';
import { EmployeeRow } from '../src/pages/Employees.js';
import { CandidateCard, RecruitingView } from '../src/pages/Recruiting.js';

const SCOPE = { organizationId: 'org_1', workspaceId: 'wsp_hr' };
const html = (node: JSX.Element): string => renderToString(node).replace(/<!-- -->/g, '');

function opening(overrides: Partial<Opening> = {}): Opening {
  return {
    id: 'job_1',
    requisitionId: 'req_1',
    title: 'Senior Backend Developer',
    department: 'Engineering Delivery',
    headcount: 2,
    employmentType: 'full_time',
    salaryMinMinorUnits: 180_000_000,
    salaryMaxMinorUnits: 240_000_000,
    currency: 'INR',
    description: 'Build and run the banking backend.',
    status: 'open',
    offersOut: 1,
    hiredCount: 0,
    seatsAvailable: 1,
    hiringManagerName: 'Rohan Mehta',
    canManage: true,
    createdAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

const NO_ACTIONS = {
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
    email: 'sarah@example.com',
    source: 'referral',
    stage: 'screening',
    nextStage: 'interview',
    feedback: [],
    history: [],
    actions: NO_ACTIONS,
    ...overrides,
  };
}

describe('RecruitingView', () => {
  it('shows HR the approved requests waiting for a position, with the approved range', () => {
    const out = html(
      <RecruitingView
        scope={SCOPE}
        openings={[]}
        canManage
        onChanged={() => undefined}
        ready={[
          {
            id: 'req_1',
            jobTitle: 'QA Engineer',
            department: 'Engineering',
            headcount: 1,
            employmentType: 'full_time',
            salaryMinMinorUnits: 120_000_000,
            salaryMaxMinorUnits: 160_000_000,
            currency: 'INR',
            justification: 'Release quality.',
            requestedByName: 'Rohan Mehta',
          },
        ]}
      />,
    );
    expect(out).toContain('Approved and waiting for a position');
    expect(out).toContain('QA Engineer');
    expect(out).toContain('raised by Rohan Mehta');
    expect(out).toContain('Open position');
  });

  it('lists positions with their seats; HR gets the controls, a hiring manager does not', () => {
    const asHr = html(
      <RecruitingView
        scope={SCOPE}
        openings={[opening()]}
        ready={[]}
        canManage
        onChanged={() => undefined}
      />,
    );
    expect(asHr).toContain('Senior Backend Developer');
    expect(asHr).toContain('Hiring manager: Rohan Mehta');
    expect(asHr).toContain('0 of 2 hired · 1 offer out');
    expect(asHr).toContain('Put on hold');
    expect(asHr).toContain('Close position');

    const asManager = html(
      <RecruitingView
        scope={SCOPE}
        openings={[opening({ canManage: false })]}
        ready={[]}
        canManage={false}
        onChanged={() => undefined}
      />,
    );
    expect(asManager).toContain('View candidates');
    expect(asManager).not.toContain('Put on hold');
    expect(asManager).not.toContain('Close position');
  });

  it('explains the empty state', () => {
    const out = html(
      <RecruitingView
        scope={SCOPE}
        openings={[]}
        ready={[]}
        canManage
        onChanged={() => undefined}
      />,
    );
    expect(out).toContain('Nothing to recruit for yet');
    expect(out).toContain('approved by the CEO and by Finance');
  });
});

describe('CandidateCard — buttons follow the server', () => {
  const card = (c: Candidate): string =>
    html(
      <CandidateCard scope={SCOPE} candidate={c} opening={opening()} onChanged={() => undefined} />,
    );

  it('no actions → no buttons', () => {
    const out = card(candidate());
    expect(out).toContain('Sarah Thomas');
    expect(out).toContain('Screening');
    for (const label of [
      'Move to',
      'Give feedback',
      'Make offer',
      'Candidate accepted',
      'Reject / withdrew',
    ]) {
      expect(out).not.toContain(label);
    }
  });

  it('HR on a screening candidate: move forward and close', () => {
    const out = card(candidate({ actions: { ...NO_ACTIONS, canAdvance: true, canClose: true } }));
    expect(out).toContain('Move to interview');
    expect(out).toContain('Reject / withdrew');
    expect(out).not.toContain('Make offer');
  });

  it('a hiring manager: feedback only', () => {
    const out = card(candidate({ actions: { ...NO_ACTIONS, canGiveFeedback: true } }));
    expect(out).toContain('Give feedback');
    expect(out).not.toContain('Move to');
    expect(out).not.toContain('Make offer');
  });

  it('shows feedback with the interviewer, and offers the offer only when allowed', () => {
    const out = card(
      candidate({
        stage: 'interview',
        nextStage: undefined,
        feedback: [
          {
            by: 'u',
            byName: 'Rohan Mehta',
            at: 't',
            stage: 'interview',
            rating: 4,
            recommendation: 'yes',
            notes: 'Strong design.',
          },
        ],
        actions: { ...NO_ACTIONS, canOffer: true, canClose: true },
      }),
    );
    expect(out).toContain('Rohan Mehta');
    expect(out).toContain('4/5');
    expect(out).toContain('Strong design.');
    expect(out).toContain('Make offer');
  });

  it('pay is shown only when the server sent it', () => {
    const withPay = card(
      candidate({
        stage: 'offer',
        offer: {
          salaryMinorUnits: 210_000_000,
          currency: 'INR',
          startDate: '2026-11-01',
          status: 'extended',
        },
        offerStatus: 'extended',
        actions: { ...NO_ACTIONS, canRecordResponse: true },
      }),
    );
    expect(withPay).toContain('21,00,000');
    expect(withPay).toContain('Candidate accepted');
    expect(withPay).toContain('Candidate declined');

    const withoutPay = card(candidate({ stage: 'offer', offerStatus: 'extended' }));
    expect(withoutPay).toContain('Offer: extended');
    expect(withoutPay).not.toContain('21,00,000');
    expect(withoutPay).not.toContain('Candidate accepted');
  });

  it('a hired candidate says an employee record was created', () => {
    expect(card(candidate({ stage: 'hired', employeeId: 'emp_1' }))).toContain(
      'employee record created',
    );
  });
});

describe('labels, progress, navigation and the employee record', () => {
  it('summarises seats', () => {
    expect(seatSummary({ headcount: 2, hiredCount: 1, offersOut: 1 })).toBe(
      '1 of 2 hired · 1 offer out',
    );
    expect(seatSummary({ headcount: 1, hiredCount: 0, offersOut: 0 })).toBe('0 of 1 hired');
  });

  it('tells the requester what HR is doing with an approved request', () => {
    expect(recruitingProgress({ status: 'pending_finance' })).toBeUndefined();
    expect(recruitingProgress({ status: 'approved' })).toBe('Waiting for HR to open the position');
    expect(
      recruitingProgress({
        status: 'approved',
        recruiting: { openingId: 'j', status: 'open', hiredCount: 1, headcount: 2 },
      }),
    ).toBe('HR is recruiting — 1 of 2 hired');
    expect(
      recruitingProgress({
        status: 'approved',
        recruiting: { openingId: 'j', status: 'filled', hiredCount: 2, headcount: 2 },
      }),
    ).toBe('Hired — 2 of 2');
  });

  it('the Recruiting menu item appears for HR, the executive and hiring managers only', () => {
    expect(isModuleVisible('Recruiting', ['recruiting.manage'])).toBe(true);
    expect(isModuleVisible('Recruiting', ['recruiting.read'])).toBe(true);
    expect(isModuleVisible('Recruiting', ['recruiting.interview'])).toBe(true);
    expect(isModuleVisible('Recruiting', ['projects.read', 'requisitions.read'])).toBe(false);
  });

  it('an employee hired through recruiting shows their real details; a legacy record still renders', () => {
    const hired = html(
      <EmployeeRow
        employee={{
          id: 'emp_1',
          organizationId: 'org_1',
          name: 'Sarah Thomas',
          status: 'hired',
          email: 'sarah@example.com',
          jobTitle: 'Senior Backend Developer',
          department: 'Engineering Delivery',
          startDate: '2026-11-01',
          createdAt: '2026-10-01T09:00:00.000Z',
        }}
      />,
    );
    expect(hired).toContain('Senior Backend Developer · Engineering Delivery');
    expect(hired).toContain('sarah@example.com · starts 2026-11-01');
    expect(hired).toContain('Hired');
    const legacy = html(
      <EmployeeRow
        employee={{
          id: 'emp_2',
          organizationId: 'org_1',
          name: 'Aarav',
          status: 'active',
          createdAt: '2026-09-01T09:00:00.000Z',
        }}
      />,
    );
    expect(legacy).toContain('Aarav');
    expect(legacy).not.toContain('starts');
  });
});
