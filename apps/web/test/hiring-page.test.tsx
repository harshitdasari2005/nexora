/**
 * Hiring requests page: the chain is shown truthfully, and a decision button
 * only renders for the person whose turn the SERVER says it is.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { chainSteps, statusLabel, type Requisition } from '../src/lib/hiring.js';
import { isModuleVisible } from '../src/lib/modules.js';
import { HiringView, historyVerb, validateRequisition } from '../src/pages/Hiring.js';

const SCOPE = { organizationId: 'org_1', workspaceId: 'wsp_1' };

function requisition(overrides: Partial<Requisition> = {}): Requisition {
  return {
    id: 'req_1',
    organizationId: 'org_1',
    workspaceId: 'wsp_1',
    requestedBy: 'usr_manager',
    requestedByName: 'Rohan Mehta',
    jobTitle: 'Senior Backend Developer',
    department: 'Engineering Delivery',
    headcount: 2,
    employmentType: 'full_time',
    salaryMinMinorUnits: 180_000_000,
    salaryMaxMinorUnits: 240_000_000,
    currency: 'INR',
    justification: 'The mobile banking rebuild needs two more backend engineers.',
    urgency: 'high',
    status: 'pending_executive',
    pendingStage: 'executive',
    round: 1,
    history: [
      {
        at: '2026-10-01T09:00:00.000Z',
        actorId: 'usr_manager',
        actorName: 'Rohan Mehta',
        action: 'submitted',
        round: 1,
      },
    ],
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    actions: { canDecide: false, canRevise: false, canWithdraw: false },
    ...overrides,
  };
}

const render = (requisitions: Requisition[], canCreate = false): string =>
  renderToString(
    <HiringView
      scope={SCOPE}
      workspaceName="Engineering Delivery"
      requisitions={requisitions}
      canCreate={canCreate}
      projects={[]}
      onChanged={() => undefined}
    />,
  ).replace(/<!-- -->/g, '');

describe('chainSteps', () => {
  const states = (r: Pick<Requisition, 'status' | 'history' | 'round'>) =>
    chainSteps(r).map((step) => step.state);

  it('a new request waits at the CEO', () => {
    expect(states(requisition())).toEqual(['done', 'current', 'waiting', 'waiting']);
  });

  it('after the CEO approves it waits at Finance; after Finance, HR takes over', () => {
    const ceo = {
      at: 't',
      actorId: 'c',
      action: 'approved' as const,
      stage: 'executive' as const,
      round: 1,
    };
    const fin = {
      at: 't',
      actorId: 'f',
      action: 'approved' as const,
      stage: 'finance' as const,
      round: 1,
    };
    const base = requisition();
    expect(
      states({ status: 'pending_finance', round: 1, history: [...base.history, ceo] }),
    ).toEqual(['done', 'done', 'current', 'waiting']);
    expect(states({ status: 'approved', round: 1, history: [...base.history, ceo, fin] })).toEqual([
      'done',
      'done',
      'done',
      'current',
    ]);
  });

  it('a request raised by the CEO shows the CEO step as not needed', () => {
    const skipped = {
      at: 't',
      actorId: 'c',
      action: 'executive_not_required' as const,
      stage: 'executive' as const,
      round: 1,
    };
    expect(
      states({ status: 'pending_finance', round: 1, history: [...requisition().history, skipped] }),
    ).toEqual(['done', 'skipped', 'current', 'waiting']);
  });

  it('a rejection marks the stage that returned it; a resubmission starts a clean round', () => {
    const rejected = {
      at: 't',
      actorId: 'f',
      action: 'rejected' as const,
      stage: 'finance' as const,
      comment: 'x',
      round: 1,
    };
    const ceo = {
      at: 't',
      actorId: 'c',
      action: 'approved' as const,
      stage: 'executive' as const,
      round: 1,
    };
    const history = [...requisition().history, ceo, rejected];
    expect(states({ status: 'changes_requested', round: 1, history })).toEqual([
      'done',
      'done',
      'returned',
      'waiting',
    ]);
    const resubmitted = { at: 't', actorId: 'm', action: 'resubmitted' as const, round: 2 };
    expect(
      states({ status: 'pending_executive', round: 2, history: [...history, resubmitted] }),
    ).toEqual(['done', 'current', 'waiting', 'waiting']);
  });
});

describe('HiringView', () => {
  it('explains the chain and offers "New hiring request" only to someone who may raise one', () => {
    expect(render([], true)).toContain('New hiring request');
    const readOnly = render([], false);
    expect(readOnly).not.toContain('New hiring request');
    expect(readOnly).toContain('No hiring requests yet');
    expect(readOnly).toContain('the CEO decides');
  });

  it("shows a request with its status, requester and progress — and NO decision buttons when it is not the caller's turn", () => {
    const html = render([requisition()]);
    expect(html).toContain('Senior Backend Developer');
    expect(html).toContain('Raised by Rohan Mehta');
    expect(html).toContain('Waiting for the CEO');
    expect(html).toContain('Urgent');
    expect(html).toContain('CEO decision');
    expect(html).not.toContain('Waiting for your decision');
    expect(html).not.toContain('>Approve<');
    expect(html).not.toContain('Reject and send back');
  });

  it('puts requests waiting for the caller first, opened, with Approve and Reject', () => {
    const html = render([
      requisition({ id: 'req_other', jobTitle: 'QA Engineer' }),
      requisition({
        id: 'req_mine',
        jobTitle: 'Data Engineer',
        actions: { canDecide: true, canRevise: false, canWithdraw: false },
      }),
    ]);
    expect(html).toContain('Waiting for your decision');
    expect(html.indexOf('Data Engineer')).toBeLessThan(html.indexOf('QA Engineer'));
    expect(html).toContain('>Approve<');
    expect(html).toContain('Reject and send back');
    expect(html).toContain('raised the request');
  });

  it('a returned request offers the requester Revise and Withdraw, and shows the reason', () => {
    const html = render([
      requisition({
        status: 'changes_requested',
        pendingStage: undefined,
        history: [
          ...requisition().history,
          {
            at: '2026-10-01T10:00:00.000Z',
            actorId: 'usr_ceo',
            actorName: 'Anika Rao',
            action: 'rejected',
            stage: 'executive',
            comment: 'One engineer is enough.',
            round: 1,
          },
        ],
        actions: { canDecide: false, canRevise: true, canWithdraw: true },
      }),
    ]);
    expect(html).toContain('Returned to the requester');
    expect(html).toContain('Revise and resubmit');
    expect(html).toContain('Withdraw request');
    expect(html).toContain('One engineer is enough.');
    expect(html).not.toContain('>Approve<');
  });

  it('tells a role-holder why they cannot decide (e.g. their own request)', () => {
    const html = render([
      requisition({
        actions: {
          canDecide: false,
          decideBlockedReason: 'You cannot decide your own hiring request',
          canRevise: true,
          canWithdraw: true,
        },
        status: 'changes_requested',
      }),
    ]);
    expect(html).toContain('You cannot decide your own hiring request');
  });
});

describe('labels, validation and navigation', () => {
  it('speaks plain language', () => {
    expect(statusLabel('pending_finance')).toBe('Waiting for Finance');
    expect(statusLabel('approved')).toBe('Approved — ready for HR');
    expect(
      historyVerb({ at: 't', actorId: 'a', action: 'approved', stage: 'finance', round: 1 }),
    ).toBe('approved it (Finance decision)');
    expect(
      historyVerb({ at: 't', actorId: 'a', action: 'rejected', stage: 'executive', round: 1 }),
    ).toBe('sent it back (CEO decision)');
  });

  it('validates the form before sending', () => {
    const fields = (input: Parameters<typeof validateRequisition>[0]) =>
      validateRequisition(input).map((issue) => issue.field);
    const ok = {
      jobTitle: 'Developer',
      department: 'Engineering',
      headcount: '2',
      salaryMin: '1800000',
      salaryMax: '2400000',
      justification: 'We need two more engineers.',
    };
    expect(fields(ok)).toEqual([]);
    expect(fields({ ...ok, jobTitle: ' ' })).toEqual(['jobTitle']);
    expect(fields({ ...ok, headcount: '0' })).toEqual(['headcount']);
    expect(fields({ ...ok, headcount: '2.5' })).toEqual(['headcount']);
    expect(fields({ ...ok, salaryMax: '100' })).toEqual(['salaryMax']);
    expect(fields({ ...ok, salaryMin: '' })).toEqual(['salaryMin']);
    expect(fields({ ...ok, justification: 'short' })).toEqual(['justification']);
  });

  it('the Hiring menu item appears for raisers and readers only', () => {
    expect(isModuleVisible('Hiring', ['requisitions.create'])).toBe(true);
    expect(isModuleVisible('Hiring', ['requisitions.read'])).toBe(true);
    expect(isModuleVisible('Hiring', ['projects.read', 'employees.read'])).toBe(false);
    expect(isModuleVisible('Hiring', [])).toBe(false);
  });
});
