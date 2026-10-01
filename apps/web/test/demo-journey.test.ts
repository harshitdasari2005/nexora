/**
 * The Guided Demo stage model: every stage is derived from facts read back
 * from the backend. These tests pin that no stage is ever `done` without its
 * proving fact, and that the honest non-success states are represented.
 */

import { describe, expect, it } from 'vitest';

import type { ApprovalStateDto } from '../src/lib/demo.js';
import {
  currentStageIndex,
  deriveStages,
  EMPTY_FACTS,
  mergeFacts,
  type JourneyFacts,
  type Observed,
} from '../src/demo/journey.js';

function approval(overrides: Partial<ApprovalStateDto> = {}): ApprovalStateDto {
  return {
    id: 'apr_1',
    capabilityId: 'workflow.hire_and_assign_employee',
    toolId: 'workflow.hire_and_assign_employee',
    requesterId: 'usr_ceo',
    requesterName: 'Anika Rao',
    status: 'awaiting_approval',
    createdAt: '2026-09-01T09:00:00.000Z',
    expiresAt: '2026-09-02T09:00:00.000Z',
    requiredApproverRoleId: 'delivery.manager',
    separationOfDuties: true,
    reason: 'consequential action',
    canDecide: false,
    runId: 'run_1',
    intent: 'workflow.hire_and_assign',
    ...overrides,
  };
}

function seen<T>(value: T, observedAs: Observed<T>['observedAs'] = 'ceo'): Observed<T> {
  return { value, observedAs };
}

const facts = (patch: Partial<JourneyFacts['hire']> = {}): JourneyFacts => ({
  ...EMPTY_FACTS('Sarah Thomas'),
  hire: { employeeName: 'Sarah Thomas', ...patch },
});

const status = (stages: ReturnType<typeof deriveStages>, id: string) =>
  stages.find((stage) => stage.id === id)?.status;

describe('deriveStages', () => {
  it('has 15 stages and marks NOTHING done without backend facts', () => {
    const stages = deriveStages(EMPTY_FACTS('Sarah Thomas'), 'ceo');
    expect(stages).toHaveLength(15);
    expect(stages.filter((stage) => stage.status === 'done')).toHaveLength(0);
    expect(stages[0]).toMatchObject({ id: 'ceo-request', status: 'active' });
    expect(currentStageIndex(stages)).toBe(0);
  });

  it('a pending approval completes the request stages and WAITS for the Team Manager', () => {
    const stages = deriveStages(facts({ approval: seen(approval()) }), 'ceo');
    expect(stages.slice(0, 4).map((s) => s.status)).toEqual(['done', 'done', 'done', 'done']);
    const waiting = stages[4];
    expect(waiting).toMatchObject({
      id: 'manager-approval',
      status: 'active',
      waitingFor: 'manager',
    });
    // Nothing after the approval is claimed.
    expect(stages.slice(5).every((s) => s.status !== 'done')).toBe(true);
  });

  it('shows the CEO’s real self-approval refusal as evidence', () => {
    const stages = deriveStages(
      facts({
        approval: seen(approval()),
        selfApproval: { httpStatus: 403, code: 'AUTHORIZATION_ERROR', message: 'nope' },
      }),
      'ceo',
    );
    const required = stages.find((s) => s.id === 'approval-required');
    expect(required?.evidence.join(' ')).toContain('HTTP 403');
  });

  it('a rejected or expired approval FAILS the stage and never proceeds', () => {
    for (const patch of [
      { status: 'rejected', decision: 'reject' as const, decidedByName: 'Rohan Mehta' },
      { status: 'expired' },
    ]) {
      const stages = deriveStages(facts({ approval: seen(approval(patch)) }), 'manager');
      expect(status(stages, 'manager-approval')).toBe('failed');
      expect(status(stages, 'employee-created')).not.toBe('done');
    }
  });

  it('an approved request is not a created employee until the registry shows one', () => {
    const granted = approval({
      status: 'executing',
      decision: 'grant',
      decidedById: 'usr_mgr',
      decidedByName: 'Rohan Mehta',
    });
    const stages = deriveStages(facts({ approval: seen(granted) }), 'manager');
    expect(status(stages, 'manager-approval')).toBe('done');
    expect(status(stages, 'employee-created')).toBe('active');
    const done = deriveStages(
      facts({
        approval: seen(granted),
        employee: seen({ id: 'emp_1', name: 'Sarah Thomas', status: 'active' }, 'manager'),
      }),
      'manager',
    );
    expect(status(done, 'employee-created')).toBe('done');
  });

  it('represents completed-but-unverified honestly (done, with a caution)', () => {
    const stages = deriveStages(
      facts({
        approval: seen(
          approval({ status: 'completed', decision: 'grant', decidedById: 'usr_mgr' }),
        ),
        workflow: seen({
          state: 'completed_unverified',
          verification: { status: 'not_independently_verified', countedSteps: 3, verifiedSteps: 1 },
        }),
      }),
      'ceo',
    );
    const verification = stages.find((s) => s.id === 'verification');
    expect(verification?.status).toBe('done');
    expect(verification?.caution).toMatch(/not read back/);
    expect(verification?.headline).toMatch(/not independently verified/);
  });

  it('a compensated workflow FAILS employee creation and verification', () => {
    const stages = deriveStages(
      facts({
        approval: seen(approval({ status: 'failed', decision: 'grant', decidedById: 'usr_mgr' })),
        workflow: seen({ state: 'compensated', rollbackSummary: 'Hire was rolled back.' }),
      }),
      'ceo',
    );
    expect(status(stages, 'employee-created')).toBe('failed');
    expect(status(stages, 'verification')).toBe('failed');
    expect(stages.find((s) => s.id === 'employee-created')?.evidence).toContain(
      'Hire was rolled back.',
    );
  });

  it('the project relationship only counts as seen by the manager when the MANAGER read it', () => {
    const members = [{ employeeName: 'Sarah Thomas', assignedAt: '2026-09-01T10:00:00.000Z' }];
    const asCeo = deriveStages(facts({ members: seen(members, 'ceo') }), 'ceo');
    expect(status(asCeo, 'project-assigned')).toBe('done');
    expect(status(asCeo, 'manager-views-project')).toBe('active');
    const asManager = deriveStages(
      facts({ members: seen(members, 'manager'), managerMembers: seen(members, 'manager') }),
      'manager',
    );
    expect(status(asManager, 'manager-views-project')).toBe('done');
  });

  it('finance: a pending expense is not a decision; utilization comes from the read-back', () => {
    const base = facts();
    const pending: JourneyFacts = {
      ...base,
      finance: {
        approval: seen(
          approval({
            capabilityId: 'finance.submit_expense',
            status: 'completed',
            decision: 'grant',
          }),
          'cfo',
        ),
        expense: seen(
          {
            id: 'exp_1',
            status: 'pending',
            amountMinorUnits: 4_500_000,
            currency: 'INR',
            description: 'x',
          },
          'cfo',
        ),
      },
    };
    expect(status(deriveStages(pending, 'cfo'), 'finance-decision')).toBe('active');
    const approved: JourneyFacts = {
      ...pending,
      finance: {
        ...pending.finance,
        expense: seen(
          {
            id: 'exp_1',
            status: 'approved',
            amountMinorUnits: 4_500_000,
            currency: 'INR',
            description: 'x',
          },
          'cfo',
        ),
        utilizationBefore: seen(
          {
            budgetId: 'b',
            name: 'B',
            currency: 'INR',
            allocatedMinorUnits: 20_000_000,
            spentMinorUnits: 4_000_000,
            utilizationPercent: 20,
          },
          'cfo',
        ),
        utilizationNow: seen(
          {
            budgetId: 'b',
            name: 'B',
            currency: 'INR',
            allocatedMinorUnits: 20_000_000,
            spentMinorUnits: 8_500_000,
            utilizationPercent: 43,
          },
          'cfo',
        ),
      },
    };
    const stage = deriveStages(approved, 'cfo').find((s) => s.id === 'finance-decision');
    expect(stage?.status).toBe('done');
    expect(stage?.evidence.join(' ')).toContain('20% → 43%');
    const rejected: JourneyFacts = {
      ...approved,
      finance: {
        ...approved.finance,
        expense: seen(
          {
            id: 'exp_1',
            status: 'rejected',
            amountMinorUnits: 1,
            currency: 'INR',
            description: 'x',
          },
          'cfo',
        ),
      },
    };
    expect(status(deriveStages(rejected, 'cfo'), 'finance-decision')).toBe('failed');
  });

  it('trace/audit/runtime of a still-pending request do not count as done', () => {
    const stages = deriveStages(
      {
        ...facts({ approval: seen(approval()) }),
        trace: {
          hireTrace: seen({ executions: 0, verifiedExecutions: 0 }),
          auditActions: seen(['Approval requested']),
          runtimeRun: seen({ runId: 'run_1', status: 'blocked' }),
        },
      },
      'ceo',
    );
    expect(['decision-trace', 'audit', 'runtime'].map((id) => status(stages, id))).not.toContain(
      'done',
    );
  });

  it('trace, audit and runtime stages need the audit-capable persona’s reads', () => {
    const stages = deriveStages(facts(), 'controller');
    expect(status(stages, 'decision-trace')).toBe('pending');
    const done = deriveStages(
      {
        ...facts({
          approval: seen(
            approval({ status: 'completed', decision: 'grant', decidedById: 'usr_mgr' }),
          ),
        }),
        finance: {
          expense: seen(
            {
              id: 'e',
              status: 'approved',
              amountMinorUnits: 1,
              currency: 'INR',
              description: 'x',
            },
            'cfo',
          ),
        },
        trace: {
          hireTrace: seen({ executions: 3, verifiedExecutions: 3, approverName: 'Rohan Mehta' }),
          auditActions: seen(['Approval granted', 'Employee created']),
          runtimeRun: seen({ runId: 'run_1', status: 'completed' }),
        },
      },
      'ceo',
    );
    expect(['decision-trace', 'audit', 'runtime'].map((id) => status(done, id))).toEqual([
      'done',
      'done',
      'done',
    ]);
  });

  it('keeps a fact an earlier persona read when the current persona cannot read it', () => {
    const earlier = facts({
      approval: seen(approval({ status: 'completed', decision: 'grant' }), 'manager'),
    });
    const merged = mergeFacts(earlier, facts());
    expect(merged.hire.approval?.observedAs).toBe('manager');
    const fresher = mergeFacts(
      merged,
      facts({ approval: seen(approval({ status: 'failed' }), 'ceo') }),
    );
    expect(fresher.hire.approval?.value.status).toBe('failed');
  });

  it('does not remember trace/audit/runtime reads across personas', () => {
    const earlier = {
      ...facts(),
      trace: { runtimeRun: seen({ runId: 'r', status: 'completed' }) },
    };
    expect(mergeFacts(earlier, facts()).trace.runtimeRun).toBeUndefined();
  });
});
