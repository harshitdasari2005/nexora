/**
 * Recruiting — the job opening (seats) and the candidate pipeline.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import {
  Candidate,
  InvalidEmployeeValueError,
  JobOpening,
  RecruitingStateError,
  type RecruitingEventContext,
} from '../src/index.js';

const ORG = 'org_1' as TenantId;
const WORKSPACE = 'wsp_eng' as WorkspaceId;
const HR = 'usr_hr';
const MANAGER = 'usr_manager';
const ctx: RecruitingEventContext = {
  actor: { kind: 'user', id: HR },
  correlationId: 'corr',
  organizationId: ORG,
};
const APPROVED = {
  salaryMinMinorUnits: 180_000_000,
  salaryMaxMinorUnits: 240_000_000,
  currency: 'INR',
};

function opening(headcount = 2) {
  return JobOpening.open(
    {
      organizationId: ORG,
      requisitionId: 'req_1',
      workspaceId: WORKSPACE,
      hiringManagerId: MANAGER,
      openedBy: HR,
      title: 'Senior Backend Developer',
      department: 'Engineering',
      headcount,
      employmentType: 'full_time',
      ...APPROVED,
      description: 'Build and run the mobile banking backend services.',
    },
    ctx,
  );
}

function candidate(name = 'Sarah Thomas') {
  return Candidate.add(
    {
      organizationId: ORG,
      openingId: 'job_1',
      workspaceId: WORKSPACE,
      name,
      email: ' Sarah.Thomas@Example.com ',
      source: 'referral',
      resumeNotes: '8 years of backend experience.',
      addedBy: HR,
    },
    ctx,
  );
}

/** A candidate interviewed and ready for an offer. */
function interviewed() {
  const c = candidate();
  c.advance(HR, ctx);
  c.advance(HR, ctx);
  c.recordFeedback(
    { by: MANAGER, rating: 4, recommendation: 'yes', notes: 'Strong system design.' },
    ctx,
  );
  return c;
}

describe('JobOpening — approved seats', () => {
  it('opens with every approved seat available', () => {
    const o = opening(2);
    expect(o.status).toBe('open');
    expect(o.seatsAvailable).toBe(2);
    expect(o.pullDomainEvents().map((event) => event.type)).toEqual(['recruiting.opening.opened']);
  });

  it('an offer holds a seat; there is never a third offer for two seats', () => {
    const o = opening(2);
    o.reserveOffer();
    o.reserveOffer();
    expect(o.seatsAvailable).toBe(0);
    expect(() => o.reserveOffer()).toThrow(RecruitingStateError);
    o.releaseOffer(); // one candidate declined
    expect(o.seatsAvailable).toBe(1);
    o.reserveOffer();
    expect(() => o.reserveOffer()).toThrow(RecruitingStateError);
  });

  it('hires fill the opening exactly at the approved headcount', () => {
    const o = opening(2);
    o.reserveOffer();
    o.confirmHire(ctx);
    expect(o.status).toBe('open');
    o.reserveOffer();
    o.confirmHire(ctx);
    expect(o.status).toBe('filled');
    expect(o.seatsAvailable).toBe(0);
    expect(() => o.reserveOffer()).toThrow(RecruitingStateError);
    expect(o.pullDomainEvents().map((event) => event.type)).toContain('recruiting.opening.filled');
  });

  it('a hire needs a held seat; nothing is released that was not held', () => {
    const o = opening(1);
    expect(() => o.confirmHire(ctx)).toThrow(RecruitingStateError);
    expect(() => o.releaseOffer()).toThrow(RecruitingStateError);
  });

  it('hold / resume / close follow the lifecycle; closing needs a reason and no open offer', () => {
    const o = opening(1);
    o.hold(ctx);
    expect(o.isRecruiting).toBe(false);
    expect(() => o.reserveOffer()).toThrow(RecruitingStateError);
    expect(() => o.hold(ctx)).toThrow(RecruitingStateError);
    o.resume(ctx);
    o.reserveOffer();
    expect(() => o.close('Budget frozen', ctx)).toThrow(RecruitingStateError);
    o.releaseOffer();
    expect(() => o.close(' ', ctx)).toThrow(InvalidEmployeeValueError);
    o.close('Budget frozen', ctx);
    expect(o.status).toBe('closed');
    expect(() => o.close('again', ctx)).toThrow(RecruitingStateError);
  });

  it('round-trips through its snapshot', () => {
    const o = opening(3);
    o.reserveOffer();
    const snapshot = JobOpening.snapshot(o);
    expect(JobOpening.snapshot(JobOpening.hydrate(JSON.parse(JSON.stringify(snapshot))))).toEqual(
      snapshot,
    );
  });
});

describe('Candidate — the pipeline', () => {
  it('is added at applied with normalized contact details', () => {
    const c = candidate();
    expect(c.stage).toBe('applied');
    expect(c.email).toBe('sarah.thomas@example.com');
    expect(c.nextStage).toBe('screening');
  });

  it.each([
    ['name', { name: ' ' }],
    ['email', { email: 'not-an-email' }],
    ['source', { source: 'linkedin' as never }],
  ])('rejects an invalid %s', (field, overrides) => {
    try {
      Candidate.add(
        {
          organizationId: ORG,
          openingId: 'job_1',
          workspaceId: WORKSPACE,
          name: 'A Person',
          email: 'a@example.com',
          source: 'referral',
          addedBy: HR,
          ...overrides,
        },
        ctx,
      );
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidEmployeeValueError).issues.map((issue) => issue.path)).toContain(
        field,
      );
    }
  });

  it('moves one stage at a time, in order', () => {
    const c = candidate();
    c.advance(HR, ctx);
    expect(c.stage).toBe('screening');
    c.advance(HR, ctx);
    expect(c.stage).toBe('interview');
    // After the interview the next step is an offer, not another "advance".
    expect(() => c.advance(HR, ctx)).toThrow(RecruitingStateError);
  });

  it('feedback: only while screening/interviewing, once per interviewer per stage, validated', () => {
    const c = candidate();
    const feedback = { by: MANAGER, rating: 4, recommendation: 'yes' as const, notes: 'Solid.' };
    expect(() => c.recordFeedback(feedback, ctx)).toThrow(RecruitingStateError); // still applied
    c.advance(HR, ctx);
    c.recordFeedback(feedback, ctx);
    expect(() => c.recordFeedback(feedback, ctx)).toThrow(RecruitingStateError); // twice, same stage
    c.recordFeedback({ ...feedback, by: HR }, ctx); // another interviewer may
    c.advance(HR, ctx);
    c.recordFeedback(feedback, ctx); // same interviewer, next stage
    for (const bad of [{ rating: 0 }, { rating: 6 }, { rating: 2.5 }, { notes: 'x' }]) {
      expect(() => c.recordFeedback({ ...feedback, by: 'usr_x', ...bad }, ctx)).toThrow(
        InvalidEmployeeValueError,
      );
    }
    expect(Candidate.snapshot(c).feedback).toHaveLength(3);
  });

  it('an offer needs the interview stage AND interview feedback', () => {
    const early = candidate();
    early.advance(HR, ctx);
    expect(() =>
      early.extendOffer(
        { salaryMinorUnits: 200_000_000, startDate: '2026-11-01', by: HR },
        APPROVED,
        ctx,
      ),
    ).toThrow(/after the interview/);
    early.advance(HR, ctx);
    expect(() =>
      early.extendOffer(
        { salaryMinorUnits: 200_000_000, startDate: '2026-11-01', by: HR },
        APPROVED,
        ctx,
      ),
    ).toThrow(/interview feedback/);
  });

  it('an offer must be inside the salary range Finance approved', () => {
    for (const salaryMinorUnits of [179_999_999, 240_000_001]) {
      const c = interviewed();
      expect(() =>
        c.extendOffer({ salaryMinorUnits, startDate: '2026-11-01', by: HR }, APPROVED, ctx),
      ).toThrow(/outside the salary range/);
      expect(c.stage).toBe('interview');
      expect(c.offer).toBeUndefined();
    }
    const edge = interviewed();
    edge.extendOffer(
      { salaryMinorUnits: 240_000_000, startDate: '2026-11-01', by: HR },
      APPROVED,
      ctx,
    );
    expect(edge.stage).toBe('offer');
    expect(edge.hasOpenOffer).toBe(true);
    expect(edge.offer).toMatchObject({ status: 'extended', currency: 'INR' });
  });

  it('accepting hires the candidate; an offer is answered only once', () => {
    const c = interviewed();
    c.extendOffer(
      { salaryMinorUnits: 200_000_000, startDate: '2026-11-01', by: HR },
      APPROVED,
      ctx,
    );
    c.acceptOffer(HR, ctx);
    expect(c.stage).toBe('hired');
    expect(c.isActive).toBe(false);
    expect(c.offer?.status).toBe('accepted');
    expect(() => c.acceptOffer(HR, ctx)).toThrow(RecruitingStateError);
    expect(() => c.declineOffer(HR, undefined, ctx)).toThrow(RecruitingStateError);
    expect(() => c.reject(HR, 'changed our mind', ctx)).toThrow(RecruitingStateError);
    c.linkEmployee('emp_1');
    expect(Candidate.snapshot(c).employeeId).toBe('emp_1');
  });

  it('declining takes the candidate out of the pipeline', () => {
    const c = interviewed();
    c.extendOffer(
      { salaryMinorUnits: 200_000_000, startDate: '2026-11-01', by: HR },
      APPROVED,
      ctx,
    );
    c.declineOffer(HR, 'Took another role.', ctx);
    expect(c.stage).toBe('withdrawn');
    expect(c.offer).toMatchObject({ status: 'declined', responseNote: 'Took another role.' });
    expect(c.hasOpenOffer).toBe(false);
  });

  it('reject / withdraw need a reason and end the process; a pending offer is rescinded', () => {
    const c = candidate();
    expect(() => c.reject(HR, ' ', ctx)).toThrow(InvalidEmployeeValueError);
    c.reject(HR, 'Not enough backend experience.', ctx);
    expect(c.stage).toBe('rejected');
    expect(() => c.advance(HR, ctx)).toThrow(RecruitingStateError);
    expect(() => c.withdraw(HR, 'too late', ctx)).toThrow(RecruitingStateError);

    const offered = interviewed();
    offered.extendOffer(
      { salaryMinorUnits: 200_000_000, startDate: '2026-11-01', by: HR },
      APPROVED,
      ctx,
    );
    offered.withdraw(HR, 'Candidate relocated.', ctx);
    expect(offered.stage).toBe('withdrawn');
    expect(offered.offer?.status).toBe('declined');
    expect(() => offered.linkEmployee('emp_1')).toThrow(RecruitingStateError);
  });

  it('events never carry contact details or amounts; snapshot round-trips', () => {
    const c = interviewed();
    c.extendOffer(
      { salaryMinorUnits: 200_000_000, startDate: '2026-11-01', by: HR },
      APPROVED,
      ctx,
    );
    const events = JSON.stringify(c.pullDomainEvents());
    expect(events).not.toContain('example.com');
    expect(events).not.toContain('200000000');
    const snapshot = Candidate.snapshot(c);
    expect(Candidate.snapshot(Candidate.hydrate(JSON.parse(JSON.stringify(snapshot))))).toEqual(
      snapshot,
    );
  });
});
