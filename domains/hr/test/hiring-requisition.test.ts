/**
 * HiringRequisition — the approval chain as a real office runs it:
 * the team's manager asks, the chief executive decides, then finance decides;
 * a rejection goes back to the requester; nobody decides their own request or
 * two stages of the same round.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import {
  HiringRequisition,
  InvalidEmployeeValueError,
  RequisitionNotPermittedError,
  RequisitionStateError,
  type RequisitionDetails,
  type RequisitionEventContext,
} from '../src/index.js';

const ORG = 'org_1' as TenantId;
const WORKSPACE = 'wsp_eng' as WorkspaceId;
const MANAGER = 'usr_manager';
const CEO = 'usr_ceo';
const CFO = 'usr_cfo';
const ctx = (actor: string): RequisitionEventContext => ({
  actor: { kind: 'user', id: actor },
  correlationId: 'corr_1',
  organizationId: ORG,
});

const DETAILS: RequisitionDetails = {
  jobTitle: 'Senior Backend Developer',
  department: 'Engineering Delivery',
  headcount: 2,
  employmentType: 'full_time',
  salaryMinMinorUnits: 180_000_000,
  salaryMaxMinorUnits: 240_000_000,
  currency: 'inr',
  justification: 'The mobile banking rebuild needs two more backend engineers.',
  urgency: 'high',
  targetStartDate: '2026-11-01',
};

function submitted(overrides: Partial<RequisitionDetails> = {}, requester = MANAGER) {
  return HiringRequisition.submit(
    {
      ...DETAILS,
      ...overrides,
      organizationId: ORG,
      workspaceId: WORKSPACE,
      requestedBy: requester,
      requesterIsExecutive: requester === CEO,
    },
    ctx(requester),
    '2026-10-01T09:00:00.000Z',
  );
}

describe('HiringRequisition — submission', () => {
  it("a manager's request waits for the executive decision", () => {
    const requisition = submitted();
    expect(requisition.status).toBe('pending_executive');
    expect(requisition.pendingStage).toBe('executive');
    expect(requisition.round).toBe(1);
    expect(requisition.details.currency).toBe('INR'); // normalized
    expect(requisition.history.map((entry) => entry.action)).toEqual(['submitted']);
    expect(requisition.pullDomainEvents().map((event) => event.type)).toEqual([
      'hiring.requisition.submitted',
    ]);
  });

  it('a request raised by the executive skips the executive stage and waits for Finance', () => {
    const requisition = submitted({}, CEO);
    expect(requisition.status).toBe('pending_finance');
    expect(requisition.history.map((entry) => entry.action)).toEqual([
      'submitted',
      'executive_not_required',
    ]);
  });

  it.each([
    ['jobTitle', { jobTitle: ' ' }],
    ['headcount', { headcount: 0 }],
    ['headcount', { headcount: 51 }],
    ['headcount', { headcount: 1.5 }],
    ['salaryMaxMinorUnits', { salaryMinMinorUnits: 10, salaryMaxMinorUnits: 5 }],
    ['salaryMinMinorUnits', { salaryMinMinorUnits: -1 }],
    ['currency', { currency: 'rupees' }],
    ['justification', { justification: 'too short' }],
    ['urgency', { urgency: 'yesterday' as never }],
    ['employmentType', { employmentType: 'gig' as never }],
    ['targetStartDate', { targetStartDate: '01/11/2026' }],
  ])('rejects an invalid %s', (field, overrides) => {
    try {
      submitted(overrides as Partial<RequisitionDetails>);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEmployeeValueError);
      expect((error as InvalidEmployeeValueError).issues.map((issue) => issue.path)).toContain(
        field,
      );
    }
  });
});

describe('HiringRequisition — the chain', () => {
  it('executive approves, then finance approves → approved, with the whole trail', () => {
    const requisition = submitted();
    requisition.decide({ stage: 'executive', decision: 'approve', actorId: CEO }, ctx(CEO));
    expect(requisition.status).toBe('pending_finance');
    requisition.decide(
      { stage: 'finance', decision: 'approve', actorId: CFO, comment: ' Within budget. ' },
      ctx(CFO),
    );
    expect(requisition.status).toBe('approved');
    expect(requisition.pendingStage).toBeUndefined();
    expect(
      requisition.history.map((entry) => [entry.action, entry.stage, entry.actorId, entry.comment]),
    ).toEqual([
      ['submitted', undefined, MANAGER, undefined],
      ['approved', 'executive', CEO, undefined],
      ['approved', 'finance', CFO, 'Within budget.'],
    ]);
    expect(requisition.pullDomainEvents().map((event) => event.type)).toEqual([
      'hiring.requisition.submitted',
      'hiring.requisition.stage_approved',
      'hiring.requisition.approved',
    ]);
  });

  it('finance cannot decide before the executive has', () => {
    const requisition = submitted();
    expect(() =>
      requisition.decide({ stage: 'finance', decision: 'approve', actorId: CFO }, ctx(CFO)),
    ).toThrow(RequisitionStateError);
    expect(requisition.status).toBe('pending_executive');
  });

  it('the requester can never decide their own request, at any stage', () => {
    const requisition = submitted();
    expect(() =>
      requisition.decide(
        { stage: 'executive', decision: 'approve', actorId: MANAGER },
        ctx(MANAGER),
      ),
    ).toThrow(RequisitionNotPermittedError);
    // Raised by the CEO: it waits for Finance, and the CEO still cannot decide it.
    const own = submitted({}, CEO);
    expect(() =>
      own.decide({ stage: 'finance', decision: 'approve', actorId: CEO }, ctx(CEO)),
    ).toThrow(RequisitionNotPermittedError);
    expect(own.status).toBe('pending_finance');
  });

  it('nobody decides two stages of the same round', () => {
    const requisition = submitted();
    requisition.decide({ stage: 'executive', decision: 'approve', actorId: CEO }, ctx(CEO));
    expect(() =>
      requisition.decide({ stage: 'finance', decision: 'approve', actorId: CEO }, ctx(CEO)),
    ).toThrow(RequisitionNotPermittedError);
    expect(requisition.decisionBlocker('finance', CEO)).toMatch(/earlier stage/);
    expect(requisition.decisionBlocker('finance', CFO)).toBeUndefined();
    expect(requisition.status).toBe('pending_finance');
  });

  it('a decided request cannot be decided again', () => {
    const requisition = submitted();
    requisition.decide({ stage: 'executive', decision: 'approve', actorId: CEO }, ctx(CEO));
    requisition.decide({ stage: 'finance', decision: 'approve', actorId: CFO }, ctx(CFO));
    for (const stage of ['executive', 'finance'] as const) {
      expect(() =>
        requisition.decide(
          { stage, decision: 'reject', actorId: 'usr_other', comment: 'no' },
          ctx('usr_other'),
        ),
      ).toThrow(RequisitionStateError);
    }
    expect(requisition.status).toBe('approved');
  });
});

describe('HiringRequisition — rejection goes back to the requester', () => {
  it('a rejection needs a reason', () => {
    const requisition = submitted();
    for (const comment of [undefined, '   ']) {
      expect(() =>
        requisition.decide(
          {
            stage: 'executive',
            decision: 'reject',
            actorId: CEO,
            ...(comment === undefined ? {} : { comment }),
          },
          ctx(CEO),
        ),
      ).toThrow(InvalidEmployeeValueError);
    }
    expect(requisition.status).toBe('pending_executive');
  });

  it('executive rejects → changes requested → the requester revises → the chain restarts', () => {
    const requisition = submitted();
    requisition.decide(
      { stage: 'executive', decision: 'reject', actorId: CEO, comment: 'One person is enough.' },
      ctx(CEO),
    );
    expect(requisition.status).toBe('changes_requested');
    expect(requisition.pendingStage).toBeUndefined();

    requisition.revise(
      { details: { ...DETAILS, headcount: 1 }, actorId: MANAGER, requesterIsExecutive: false },
      ctx(MANAGER),
    );
    expect(requisition.status).toBe('pending_executive');
    expect(requisition.round).toBe(2);
    expect(requisition.details.headcount).toBe(1);
    // The same executive may decide the NEW round.
    requisition.decide({ stage: 'executive', decision: 'approve', actorId: CEO }, ctx(CEO));
    expect(requisition.status).toBe('pending_finance');
  });

  it('finance rejects → back to the requester; after revising, the executive decides again', () => {
    const requisition = submitted();
    requisition.decide({ stage: 'executive', decision: 'approve', actorId: CEO }, ctx(CEO));
    requisition.decide(
      {
        stage: 'finance',
        decision: 'reject',
        actorId: CFO,
        comment: 'Salary band is over budget.',
      },
      ctx(CFO),
    );
    expect(requisition.status).toBe('changes_requested');
    requisition.revise(
      {
        details: { ...DETAILS, salaryMaxMinorUnits: 200_000_000 },
        actorId: MANAGER,
        requesterIsExecutive: false,
      },
      ctx(MANAGER),
    );
    expect(requisition.status).toBe('pending_executive');
    expect(requisition.history.at(-1)).toMatchObject({ action: 'resubmitted', round: 2 });
  });

  it('only the requester revises, and only a returned request', () => {
    const requisition = submitted();
    expect(() =>
      requisition.revise(
        { details: DETAILS, actorId: MANAGER, requesterIsExecutive: false },
        ctx(MANAGER),
      ),
    ).toThrow(RequisitionStateError);
    requisition.decide(
      { stage: 'executive', decision: 'reject', actorId: CEO, comment: 'Explain the need.' },
      ctx(CEO),
    );
    expect(() =>
      requisition.revise({ details: DETAILS, actorId: CEO, requesterIsExecutive: true }, ctx(CEO)),
    ).toThrow(RequisitionNotPermittedError);
    expect(requisition.status).toBe('changes_requested');
  });
});

describe('HiringRequisition — withdrawal and persistence', () => {
  it('the requester may withdraw until it is approved; nobody else may', () => {
    const requisition = submitted();
    expect(() => requisition.withdraw({ actorId: CEO }, ctx(CEO))).toThrow(
      RequisitionNotPermittedError,
    );
    requisition.withdraw({ actorId: MANAGER, comment: 'Role filled internally.' }, ctx(MANAGER));
    expect(requisition.status).toBe('withdrawn');
    expect(() => requisition.withdraw({ actorId: MANAGER }, ctx(MANAGER))).toThrow(
      RequisitionStateError,
    );

    const approved = submitted();
    approved.decide({ stage: 'executive', decision: 'approve', actorId: CEO }, ctx(CEO));
    approved.decide({ stage: 'finance', decision: 'approve', actorId: CFO }, ctx(CFO));
    expect(() => approved.withdraw({ actorId: MANAGER }, ctx(MANAGER))).toThrow(
      RequisitionStateError,
    );
  });

  it('every change bumps the version; snapshot → hydrate round-trips exactly', () => {
    const requisition = submitted();
    expect(requisition.version).toBe(1);
    requisition.decide({ stage: 'executive', decision: 'approve', actorId: CEO }, ctx(CEO));
    expect(requisition.version).toBe(2);
    const snapshot = HiringRequisition.snapshot(requisition);
    const restored = HiringRequisition.hydrate(JSON.parse(JSON.stringify(snapshot)));
    expect(HiringRequisition.snapshot(restored)).toEqual(snapshot);
    expect(restored.pullDomainEvents()).toEqual([]);
  });
});
