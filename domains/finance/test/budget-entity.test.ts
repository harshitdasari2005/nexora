/**
 * Budget aggregate tests: creation, guarded lifecycle transitions
 * (active → under_review → active, active|under_review → closed), event
 * recording, snapshot/hydrate round-trips (DOMAIN_MODEL.md §4.4).
 */

import { describe, expect, it } from 'vitest';

import { Budget, FinanceStateTransitionError } from '../src/index.js';
import { TENANT, WORKSPACE, USER, q3Period, financeContext } from './helpers.js';

/** Creates an active budget with events pulled (ready for mutations). */
function activeBudget(): Budget {
  const budget = Budget.create(
    {
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      createdBy: USER,
      name: 'Marketing Q3',
      allocatedMinorUnits: 100_000,
      currency: 'INR',
      ...q3Period(),
    },
    financeContext(),
  );
  budget.pullDomainEvents();
  return budget;
}

describe('Budget.create', () => {
  it('creates an active budget with a valid id, scope, name, amount, and period', () => {
    const budget = Budget.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        createdBy: USER,
        name: '  Marketing Q3  ',
        allocatedMinorUnits: 100_000,
        currency: 'INR',
        ...q3Period(),
      },
      financeContext(),
    );
    expect(budget.id).toMatch(/^bud_/);
    expect(budget.organizationId).toBe(TENANT);
    expect(budget.workspaceId).toBe(WORKSPACE);
    expect(budget.createdBy).toBe(USER);
    expect(budget.name.value).toBe('Marketing Q3');
    expect(budget.allocated.minorUnits).toBe(100_000);
    expect(budget.allocated.currency).toBe('INR');
    expect(budget.period.periodStart).toBe('2026-07-01T00:00:00.000Z');
    expect(budget.status.value).toBe('active');
    expect(budget.version).toBe(1);
    expect(budget.status.isActive()).toBe(true);
  });

  it('records a single finance.budget.created event with envelope context', () => {
    const context = financeContext(USER, TENANT, WORKSPACE, 'corr_1');
    const budget = Budget.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        createdBy: USER,
        name: 'Marketing Q3',
        allocatedMinorUnits: 100_000,
        currency: 'INR',
        ...q3Period(),
      },
      context,
    );
    const events = budget.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('finance.budget.created');
    expect(events[0]?.correlationId).toBe('corr_1');
    expect(events[0]?.tenantId).toBe(TENANT);
    expect(events[0]?.workspaceId).toBe(WORKSPACE);
    expect((events[0]?.payload as { allocatedMinorUnits: number }).allocatedMinorUnits).toBe(
      100_000,
    );
  });

  it('rejects an empty name before any state exists (no partial aggregate)', () => {
    expect(() =>
      Budget.create(
        {
          organizationId: TENANT,
          workspaceId: WORKSPACE,
          createdBy: USER,
          name: '   ',
          allocatedMinorUnits: 100_000,
          currency: 'INR',
          ...q3Period(),
        },
        financeContext(),
      ),
    ).toThrow();
  });

  it('rejects a negative allocated amount', () => {
    expect(() =>
      Budget.create(
        {
          organizationId: TENANT,
          workspaceId: WORKSPACE,
          createdBy: USER,
          name: 'Marketing Q3',
          allocatedMinorUnits: -1,
          currency: 'INR',
          ...q3Period(),
        },
        financeContext(),
      ),
    ).toThrow();
  });

  it('rejects an invalid currency code', () => {
    expect(() =>
      Budget.create(
        {
          organizationId: TENANT,
          workspaceId: WORKSPACE,
          createdBy: USER,
          name: 'Marketing Q3',
          allocatedMinorUnits: 100_000,
          currency: 'rs',
          ...q3Period(),
        },
        financeContext(),
      ),
    ).toThrow();
  });

  it('rejects a backwards period', () => {
    expect(() =>
      Budget.create(
        {
          organizationId: TENANT,
          workspaceId: WORKSPACE,
          createdBy: USER,
          name: 'Marketing Q3',
          allocatedMinorUnits: 100_000,
          currency: 'INR',
          periodStart: '2026-09-30T00:00:00.000Z',
          periodEnd: '2026-07-01T00:00:00.000Z',
        },
        financeContext(),
      ),
    ).toThrow();
  });
});

describe('Budget lifecycle transitions', () => {
  it('revises name/amount/period while active and records a revised event', () => {
    const budget = activeBudget();
    budget.revise(
      {
        name: 'Marketing Q3 (revised)',
        allocatedMinorUnits: 150_000,
        currency: 'INR',
        ...q3Period(),
      },
      financeContext(),
    );
    expect(budget.name.value).toBe('Marketing Q3 (revised)');
    expect(budget.allocated.minorUnits).toBe(150_000);
    expect(budget.version).toBe(2);
    const events = budget.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['finance.budget.revised']);
  });

  it('flags an active budget for review, then clears the flag', () => {
    const budget = activeBudget();
    budget.flagForReview(financeContext());
    expect(budget.status.value).toBe('under_review');
    expect(budget.pullDomainEvents().map((e) => e.type)).toEqual([
      'finance.budget.flagged_for_review',
    ]);

    budget.clearReview(financeContext());
    expect(budget.status.value).toBe('active');
    expect(budget.pullDomainEvents().map((e) => e.type)).toEqual(['finance.budget.review_cleared']);
  });

  it('flagging an already under_review budget is idempotent (no error, no duplicate event)', () => {
    const budget = activeBudget();
    budget.flagForReview(financeContext());
    budget.pullDomainEvents();
    expect(() => budget.flagForReview(financeContext())).not.toThrow();
    expect(budget.pullDomainEvents()).toEqual([]);
  });

  it('closes an active budget (terminal) and records a closed event', () => {
    const budget = activeBudget();
    budget.close(financeContext());
    expect(budget.status.value).toBe('closed');
    expect(budget.status.isTerminal()).toBe(true);
    expect(budget.pullDomainEvents().map((e) => e.type)).toEqual(['finance.budget.closed']);
  });

  it('closes an under_review budget (terminal)', () => {
    const budget = activeBudget();
    budget.flagForReview(financeContext());
    budget.pullDomainEvents();
    budget.close(financeContext());
    expect(budget.status.value).toBe('closed');
  });

  it('cannot revise, flag, or clear-review a closed budget', () => {
    const budget = activeBudget();
    budget.close(financeContext());
    budget.pullDomainEvents();
    expect(() =>
      budget.revise(
        { name: 'Too late', allocatedMinorUnits: 1, currency: 'INR', ...q3Period() },
        financeContext(),
      ),
    ).toThrow(FinanceStateTransitionError);
    expect(() => budget.flagForReview(financeContext())).toThrow(FinanceStateTransitionError);
    expect(() => budget.clearReview(financeContext())).toThrow(FinanceStateTransitionError);
    expect(() => budget.close(financeContext())).toThrow(FinanceStateTransitionError);
  });

  it('cannot clear the review flag of an active (never-flagged) budget', () => {
    const budget = activeBudget();
    expect(() => budget.clearReview(financeContext())).toThrow(FinanceStateTransitionError);
  });

  it('no partial mutation on a failed revise (name/amount/version unchanged)', () => {
    const budget = activeBudget();
    const before = budget.version;
    expect(() =>
      budget.revise(
        { name: '', allocatedMinorUnits: 1, currency: 'INR', ...q3Period() },
        financeContext(),
      ),
    ).toThrow();
    expect(budget.name.value).toBe('Marketing Q3');
    expect(budget.version).toBe(before);
  });
});

describe('Budget snapshot / hydrate', () => {
  it('round-trips through snapshot and hydrate without re-emitting events', () => {
    const budget = activeBudget();
    budget.flagForReview(financeContext());
    const snapshot = Budget.snapshot(budget);

    const restored = Budget.hydrate(snapshot);
    expect(restored.id).toBe(budget.id);
    expect(restored.organizationId).toBe(budget.organizationId);
    expect(restored.workspaceId).toBe(budget.workspaceId);
    expect(restored.createdBy).toBe(budget.createdBy);
    expect(restored.name.value).toBe('Marketing Q3');
    expect(restored.allocated.minorUnits).toBe(100_000);
    expect(restored.status.value).toBe('under_review');
    expect(restored.version).toBe(budget.version);
    expect(restored.pullDomainEvents()).toEqual([]);
  });

  it('hydrate re-validates values at load', () => {
    const budget = activeBudget();
    expect(() =>
      Budget.hydrate({
        ...Budget.snapshot(budget),
        name: 'x'.repeat(121),
      }),
    ).toThrow();
  });
});
