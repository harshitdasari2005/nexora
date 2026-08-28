/**
 * Expense aggregate tests: submission, guarded decision transitions
 * (pending → approved | rejected, both terminal — BR-19), event recording,
 * snapshot/hydrate round-trips (DOMAIN_MODEL.md §4.4).
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';

import {
  BudgetId,
  Expense,
  ExpenseSelfApprovalError,
  FinanceStateTransitionError,
} from '../src/index.js';
import { TENANT, WORKSPACE, USER, financeContext } from './helpers.js';

const BUDGET_ID = BudgetId.create();
const APPROVER = 'usr_cfo' as UserId;

/** Submits a pending expense with events pulled (ready for mutations). */
function pendingExpense(): Expense {
  const expense = Expense.submit(
    {
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      budgetId: BUDGET_ID,
      submittedBy: USER,
      description: 'Conference travel',
      amountMinorUnits: 25_000,
      currency: 'INR',
    },
    financeContext(),
  );
  expense.pullDomainEvents();
  return expense;
}

describe('Expense.submit', () => {
  it('submits a pending expense with a valid id, scope, budget link, and amount', () => {
    const expense = Expense.submit(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        budgetId: BUDGET_ID,
        submittedBy: USER,
        description: '  Conference travel  ',
        amountMinorUnits: 25_000,
        currency: 'INR',
      },
      financeContext(),
    );
    expect(expense.id).toMatch(/^exp_/);
    expect(expense.organizationId).toBe(TENANT);
    expect(expense.workspaceId).toBe(WORKSPACE);
    expect(expense.budgetId).toBe(BUDGET_ID);
    expect(expense.submittedBy).toBe(USER);
    expect(expense.description.value).toBe('Conference travel');
    expect(expense.amount.minorUnits).toBe(25_000);
    expect(expense.status.value).toBe('pending');
    expect(expense.status.isPending()).toBe(true);
    expect(expense.decidedBy).toBeUndefined();
    expect(expense.decidedAt).toBeUndefined();
    expect(expense.version).toBe(1);
  });

  it('records a single finance.expense.submitted event with envelope context', () => {
    const context = financeContext(USER, TENANT, WORKSPACE, 'corr_1');
    const expense = Expense.submit(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        budgetId: BUDGET_ID,
        submittedBy: USER,
        description: 'Conference travel',
        amountMinorUnits: 25_000,
        currency: 'INR',
      },
      context,
    );
    const events = expense.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('finance.expense.submitted');
    expect(events[0]?.correlationId).toBe('corr_1');
    expect((events[0]?.payload as { amountMinorUnits: number }).amountMinorUnits).toBe(25_000);
  });

  it('rejects an empty description before any state exists', () => {
    expect(() =>
      Expense.submit(
        {
          organizationId: TENANT,
          workspaceId: WORKSPACE,
          budgetId: BUDGET_ID,
          submittedBy: USER,
          description: '   ',
          amountMinorUnits: 25_000,
          currency: 'INR',
        },
        financeContext(),
      ),
    ).toThrow();
  });

  it('rejects a negative amount (the domain Money bound — a non-positive expense amount is an application-layer validation concern, see validateSubmitExpense)', () => {
    expect(() =>
      Expense.submit(
        {
          organizationId: TENANT,
          workspaceId: WORKSPACE,
          budgetId: BUDGET_ID,
          submittedBy: USER,
          description: 'Conference travel',
          amountMinorUnits: -1,
          currency: 'INR',
        },
        financeContext(),
      ),
    ).toThrow();
  });

  it('rejects a malformed budget id', () => {
    expect(() =>
      Expense.submit(
        {
          organizationId: TENANT,
          workspaceId: WORKSPACE,
          budgetId: 'not-a-budget-id' as unknown as BudgetId,
          submittedBy: USER,
          description: 'Conference travel',
          amountMinorUnits: 25_000,
          currency: 'INR',
        },
        financeContext(),
      ),
    ).toThrow();
  });
});

describe('Expense decision transitions', () => {
  it('approves a pending expense (terminal) and records an approved event', () => {
    const expense = pendingExpense();
    expense.approve(APPROVER, financeContext());
    expect(expense.status.value).toBe('approved');
    expect(expense.status.isTerminal()).toBe(true);
    expect(expense.decidedBy).toBe(APPROVER);
    expect(expense.decidedAt).toBeDefined();
    expect(expense.version).toBe(2);
    expect(expense.pullDomainEvents().map((e) => e.type)).toEqual(['finance.expense.approved']);
  });

  it('rejects a pending expense (terminal) and records a rejected event', () => {
    const expense = pendingExpense();
    expense.reject(APPROVER, financeContext());
    expect(expense.status.value).toBe('rejected');
    expect(expense.decidedBy).toBe(APPROVER);
    expect(expense.pullDomainEvents().map((e) => e.type)).toEqual(['finance.expense.rejected']);
  });

  it('forbids the submitter from approving their own expense (segregation of duties)', () => {
    const expense = pendingExpense();
    expect(() => expense.approve(USER, financeContext())).toThrow(ExpenseSelfApprovalError);
    // The expense is untouched: still pending, no decision recorded, no event.
    expect(expense.status.value).toBe('pending');
    expect(expense.decidedBy).toBeUndefined();
    expect(expense.version).toBe(1);
    expect(expense.pullDomainEvents()).toHaveLength(0);
  });

  it('still lets the submitter reject (withdraw) their own pending expense', () => {
    const expense = pendingExpense();
    expense.reject(USER, financeContext());
    expect(expense.status.value).toBe('rejected');
    expect(expense.decidedBy).toBe(USER);
  });

  it('cannot decide an already-approved expense again', () => {
    const expense = pendingExpense();
    expense.approve(APPROVER, financeContext());
    expense.pullDomainEvents();
    expect(() => expense.approve(APPROVER, financeContext())).toThrow(FinanceStateTransitionError);
    expect(() => expense.reject(APPROVER, financeContext())).toThrow(FinanceStateTransitionError);
  });

  it('cannot decide an already-rejected expense again', () => {
    const expense = pendingExpense();
    expense.reject(APPROVER, financeContext());
    expense.pullDomainEvents();
    expect(() => expense.approve(APPROVER, financeContext())).toThrow(FinanceStateTransitionError);
  });
});

describe('Expense snapshot / hydrate', () => {
  it('round-trips through snapshot and hydrate without re-emitting events', () => {
    const expense = pendingExpense();
    expense.approve(APPROVER, financeContext());
    const snapshot = Expense.snapshot(expense);

    const restored = Expense.hydrate(snapshot);
    expect(restored.id).toBe(expense.id);
    expect(restored.budgetId).toBe(expense.budgetId);
    expect(restored.status.value).toBe('approved');
    expect(restored.decidedBy).toBe(APPROVER);
    expect(restored.version).toBe(expense.version);
    expect(restored.pullDomainEvents()).toEqual([]);
  });

  it('hydrate re-validates values at load', () => {
    const expense = pendingExpense();
    expect(() =>
      Expense.hydrate({
        ...Expense.snapshot(expense),
        description: 'x'.repeat(121),
      }),
    ).toThrow();
  });
});
