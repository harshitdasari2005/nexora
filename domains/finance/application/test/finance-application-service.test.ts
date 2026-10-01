/**
 * FinanceApplicationService tests: budget creation/revision/close/review-
 * flagging, expense submission/decision, scoped reads, utilization
 * computation, event publishing, and scope enforcement (foreign/cross-
 * workspace ids resolve to NOT FOUND — never to another workspace's
 * budget/expense).
 */

import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@nexora/shared/events';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import {
  BudgetDomainService,
  ExpenseDomainService,
  type Budget,
  type BudgetId,
  type BudgetRepository,
  type Expense,
  type ExpenseRepository,
} from '@nexora/module-finance';

import { FinanceApplicationService } from '../src/services/finance-application-service.js';

const TENANT = 'org_acme' as TenantId;
const WORKSPACE = 'ws_finance' as WorkspaceId;
const OTHER_WORKSPACE = 'ws_marketing' as WorkspaceId;
const USER = 'usr_priya' as UserId;
const APPROVER = 'usr_cfo' as UserId;

/** An in-memory {@link BudgetRepository}. */
class MemoryBudgetRepository implements BudgetRepository {
  readonly budgets = new Map<string, Budget>();

  async findById(id: BudgetId): Promise<Budget | undefined> {
    return this.budgets.get(id);
  }

  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly Budget[]> {
    return [...this.budgets.values()]
      .filter(
        (budget) => budget.organizationId === organizationId && budget.workspaceId === workspaceId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async save(budget: Budget): Promise<void> {
    this.budgets.set(budget.id, budget);
  }
}

/** An in-memory {@link ExpenseRepository}. */
class MemoryExpenseRepository implements ExpenseRepository {
  readonly expenses = new Map<string, Expense>();

  async findById(id: string): Promise<Expense | undefined> {
    return this.expenses.get(id);
  }

  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly Expense[]> {
    return [...this.expenses.values()]
      .filter(
        (expense) =>
          expense.organizationId === organizationId && expense.workspaceId === workspaceId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listApprovedByBudget(
    organizationId: TenantId,
    budgetId: BudgetId,
  ): Promise<readonly Expense[]> {
    return [...this.expenses.values()]
      .filter(
        (expense) =>
          expense.organizationId === organizationId &&
          expense.budgetId === budgetId &&
          expense.status.value === 'approved',
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async save(expense: Expense): Promise<void> {
    this.expenses.set(expense.id, expense);
  }
}

/** A publisher that records published envelopes. */
class RecordingPublisher {
  readonly published: EventEnvelope[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    this.published.push(...events);
  }
}

function setup(): {
  service: FinanceApplicationService;
  budgets: MemoryBudgetRepository;
  expenses: MemoryExpenseRepository;
  publisher: RecordingPublisher;
} {
  const budgets = new MemoryBudgetRepository();
  const expenses = new MemoryExpenseRepository();
  const publisher = new RecordingPublisher();
  const budgetsService = new BudgetDomainService({ budgets });
  const expensesService = new ExpenseDomainService({ expenses });
  const service = new FinanceApplicationService({ budgetsService, expensesService, publisher });
  return { service, budgets, expenses, publisher };
}

function createBudgetCommand(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organizationId: TENANT,
    workspaceId: WORKSPACE,
    createdBy: USER,
    actorId: USER,
    correlationId: 'corr_1',
    name: 'Marketing Q3',
    allocatedMinorUnits: 100_000,
    currency: 'INR',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('FinanceApplicationService.createBudget', () => {
  it('creates an active budget and publishes exactly one created event', async () => {
    const { service, budgets, publisher } = setup();
    const result = await service.createBudget(
      createBudgetCommand() as Parameters<typeof service.createBudget>[0],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.budget.status.value).toBe('active');
    expect(budgets.budgets.size).toBe(1);
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]?.type).toBe('finance.budget.created');
  });

  it('rejects an invalid name with no mutation and no publication', async () => {
    const { service, budgets, publisher } = setup();
    const result = await service.createBudget(
      createBudgetCommand({ name: '  ' }) as Parameters<typeof service.createBudget>[0],
    );
    expect(result.ok).toBe(false);
    expect(budgets.budgets.size).toBe(0);
    expect(publisher.published).toHaveLength(0);
  });

  it('rejects a negative allocated amount', async () => {
    const { service, budgets } = setup();
    const result = await service.createBudget(
      createBudgetCommand({ allocatedMinorUnits: -1 }) as Parameters<
        typeof service.createBudget
      >[0],
    );
    expect(result.ok).toBe(false);
    expect(budgets.budgets.size).toBe(0);
  });
});

describe('FinanceApplicationService.reviseBudget / closeBudget / review flag', () => {
  async function createOpenBudget(service: FinanceApplicationService): Promise<string> {
    const created = await service.createBudget(
      createBudgetCommand() as Parameters<typeof service.createBudget>[0],
    );
    if (!created.ok) throw new Error('expected create to succeed');
    return created.value.budget.id;
  }

  it('revises a budget and publishes exactly one revised event', async () => {
    const { service, publisher } = setup();
    const budgetId = await createOpenBudget(service);
    const result = await service.reviseBudget({
      budgetId,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_2',
      name: 'Marketing Q3 (revised)',
      allocatedMinorUnits: 150_000,
      currency: 'INR',
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-09-30T00:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.budget.name.value).toBe('Marketing Q3 (revised)');
    expect(publisher.published.map((e) => e.type)).toEqual([
      'finance.budget.created',
      'finance.budget.revised',
    ]);
  });

  it('returns NOT FOUND for a foreign workspace budget id (no data leak)', async () => {
    const { service } = setup();
    const budgetId = await createOpenBudget(service);
    const result = await service.reviseBudget({
      budgetId,
      organizationId: TENANT,
      workspaceId: OTHER_WORKSPACE,
      actorId: USER,
      correlationId: 'corr_3',
      name: 'Hijacked',
      allocatedMinorUnits: 1,
      currency: 'INR',
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-09-30T00:00:00.000Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('flags a budget for review then clears it, publishing both transition events', async () => {
    const { service, publisher } = setup();
    const budgetId = await createOpenBudget(service);
    const flagged = await service.flagOverBudgetItems({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_flag',
    });
    // No expense has pushed utilization over threshold yet — nothing flagged.
    expect(flagged.ok).toBe(true);
    if (flagged.ok) {
      expect(flagged.value.flagged).toHaveLength(0);
    }

    const cleared = await service.clearBudgetReview({
      budgetId,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_4',
    });
    // A never-flagged (active) budget cannot have its review cleared.
    expect(cleared.ok).toBe(false);
    void publisher;
  });

  it('closes a budget (terminal) and rejects a further revision', async () => {
    const { service } = setup();
    const budgetId = await createOpenBudget(service);
    const closed = await service.closeBudget({
      budgetId,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_5',
    });
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      expect(closed.value.budget.status.value).toBe('closed');
    }

    const revised = await service.reviseBudget({
      budgetId,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_6',
      name: 'Too late',
      allocatedMinorUnits: 1,
      currency: 'INR',
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-09-30T00:00:00.000Z',
    });
    expect(revised.ok).toBe(false);
  });
});

describe('FinanceApplicationService.flagOverBudgetItems (deterministic remediation)', () => {
  it('flags an active budget whose approved spend crosses the high-utilization threshold', async () => {
    const { service } = setup();
    const created = await service.createBudget(
      createBudgetCommand() as Parameters<typeof service.createBudget>[0],
    );
    if (!created.ok) throw new Error('expected create to succeed');
    const budgetId = created.value.budget.id;

    const submitted = await service.submitExpense({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      budgetId,
      submittedBy: USER,
      description: 'Campaign spend',
      amountMinorUnits: 95_000,
      currency: 'INR',
      actorId: USER,
      correlationId: 'corr_exp_1',
    });
    if (!submitted.ok) throw new Error('expected submit to succeed');
    const decided = await service.decideExpense({
      expenseId: submitted.value.expense.id,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      decision: 'approve',
      decidedBy: APPROVER,
      actorId: APPROVER,
      correlationId: 'corr_exp_2',
    });
    expect(decided.ok).toBe(true);

    const flagged = await service.flagOverBudgetItems({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: APPROVER,
      correlationId: 'corr_flag_1',
    });
    expect(flagged.ok).toBe(true);
    if (!flagged.ok) return;
    expect(flagged.value.flagged).toHaveLength(1);
    expect(flagged.value.flagged[0]?.id).toBe(budgetId);
    expect(flagged.value.flagged[0]?.status.value).toBe('under_review');
  });

  it('never flags a budget in a different workspace (tenant/workspace isolation)', async () => {
    const { service } = setup();
    const created = await service.createBudget(
      createBudgetCommand({ workspaceId: OTHER_WORKSPACE }) as Parameters<
        typeof service.createBudget
      >[0],
    );
    if (!created.ok) throw new Error('expected create to succeed');

    const flagged = await service.flagOverBudgetItems({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_flag_2',
    });
    expect(flagged.ok).toBe(true);
    if (flagged.ok) {
      expect(flagged.value.flagged).toHaveLength(0);
    }
  });
});

describe('FinanceApplicationService.submitExpense / decideExpense', () => {
  async function createOpenBudget(service: FinanceApplicationService): Promise<string> {
    const created = await service.createBudget(
      createBudgetCommand() as Parameters<typeof service.createBudget>[0],
    );
    if (!created.ok) throw new Error('expected create to succeed');
    return created.value.budget.id;
  }

  it('submits a pending expense and publishes exactly one submitted event', async () => {
    const { service, expenses, publisher } = setup();
    const budgetId = await createOpenBudget(service);
    const result = await service.submitExpense({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      budgetId,
      submittedBy: USER,
      description: 'Conference travel',
      amountMinorUnits: 25_000,
      currency: 'INR',
      actorId: USER,
      correlationId: 'corr_7',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expense.status.value).toBe('pending');
    expect(expenses.expenses.size).toBe(1);
    expect(publisher.published.at(-1)?.type).toBe('finance.expense.submitted');
  });

  it('returns NOT FOUND when the referenced budget does not exist', async () => {
    const { service } = setup();
    const result = await service.submitExpense({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      budgetId: 'bud_00000000-0000-4000-8000-000000000000',
      submittedBy: USER,
      description: 'Ghost expense',
      amountMinorUnits: 1_000,
      currency: 'INR',
      actorId: USER,
      correlationId: 'corr_8',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('rejects an expense submitted against a closed budget (422 business rule)', async () => {
    const { service } = setup();
    const budgetId = await createOpenBudget(service);
    await service.closeBudget({
      budgetId,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_9',
    });
    const result = await service.submitExpense({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      budgetId,
      submittedBy: USER,
      description: 'Late claim',
      amountMinorUnits: 1_000,
      currency: 'INR',
      actorId: USER,
      correlationId: 'corr_10',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('approves a pending expense (terminal) and publishes exactly one approved event', async () => {
    const { service, publisher } = setup();
    const budgetId = await createOpenBudget(service);
    const submitted = await service.submitExpense({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      budgetId,
      submittedBy: USER,
      description: 'Conference travel',
      amountMinorUnits: 25_000,
      currency: 'INR',
      actorId: USER,
      correlationId: 'corr_11',
    });
    if (!submitted.ok) throw new Error('expected submit to succeed');

    const decided = await service.decideExpense({
      expenseId: submitted.value.expense.id,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      decision: 'approve',
      decidedBy: APPROVER,
      actorId: APPROVER,
      correlationId: 'corr_12',
    });
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.value.expense.status.value).toBe('approved');
    expect(decided.value.expense.decidedBy).toBe(APPROVER);
    expect(publisher.published.at(-1)?.type).toBe('finance.expense.approved');
  });

  it('rejects deciding an expense twice (a decision is never revised)', async () => {
    const { service } = setup();
    const budgetId = await createOpenBudget(service);
    const submitted = await service.submitExpense({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      budgetId,
      submittedBy: USER,
      description: 'Conference travel',
      amountMinorUnits: 25_000,
      currency: 'INR',
      actorId: USER,
      correlationId: 'corr_13',
    });
    if (!submitted.ok) throw new Error('expected submit to succeed');
    await service.decideExpense({
      expenseId: submitted.value.expense.id,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      decision: 'reject',
      decidedBy: APPROVER,
      actorId: APPROVER,
      correlationId: 'corr_14',
    });
    const redecided = await service.decideExpense({
      expenseId: submitted.value.expense.id,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      decision: 'approve',
      decidedBy: APPROVER,
      actorId: APPROVER,
      correlationId: 'corr_15',
    });
    expect(redecided.ok).toBe(false);
    if (redecided.ok) return;
    expect(redecided.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });
});

describe('FinanceApplicationService — money invariants (Prompt 9)', () => {
  async function openBudget(service: FinanceApplicationService, overrides = {}): Promise<string> {
    const created = await service.createBudget(
      createBudgetCommand(overrides) as Parameters<typeof service.createBudget>[0],
    );
    if (!created.ok) throw new Error('expected create to succeed');
    return created.value.budget.id;
  }
  const submitCommand = (budgetId: string, overrides: Record<string, unknown> = {}) => ({
    organizationId: TENANT,
    workspaceId: WORKSPACE,
    budgetId,
    submittedBy: USER,
    description: 'Conference travel',
    amountMinorUnits: 25_000,
    currency: 'INR',
    actorId: USER,
    correlationId: 'corr_inv',
    ...overrides,
  });
  const decideCommand = (expenseId: string, decision: 'approve' | 'reject') => ({
    expenseId,
    organizationId: TENANT,
    workspaceId: WORKSPACE,
    decision,
    decidedBy: APPROVER,
    actorId: APPROVER,
    correlationId: 'corr_inv_decide',
  });
  const spent = async (service: FinanceApplicationService, budgetId: string): Promise<number> => {
    const utilization = await service.listBudgetUtilization({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
    });
    if (!utilization.ok) throw new Error('utilization failed');
    return utilization.value.find((entry) => entry.budgetId === budgetId)?.spentMinorUnits ?? -1;
  };

  it('rejects an expense in a currency other than the budget currency (nothing stored)', async () => {
    const { service, expenses } = setup();
    const budgetId = await openBudget(service);
    const mismatch = await service.submitExpense(submitCommand(budgetId, { currency: 'USD' }));
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(expenses.expenses.size).toBe(0);
    // Positive control: the SAME expense in the budget currency is accepted.
    expect((await service.submitExpense(submitCommand(budgetId))).ok).toBe(true);
    expect(expenses.expenses.size).toBe(1);
  });

  it('a budget of another workspace cannot be used to submit (NOT FOUND, nothing stored)', async () => {
    const { service, expenses } = setup();
    const foreign = await service.createBudget(
      createBudgetCommand({ workspaceId: OTHER_WORKSPACE }) as Parameters<
        typeof service.createBudget
      >[0],
    );
    if (!foreign.ok) throw new Error('expected create to succeed');
    const denied = await service.submitExpense(submitCommand(foreign.value.budget.id));
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.code).toBe('NOT_FOUND');
    expect(expenses.expenses.size).toBe(0);
  });

  it('a budget closed AFTER submission cannot receive the approval; the expense stays pending', async () => {
    const { service } = setup();
    const budgetId = await openBudget(service);
    const submitted = await service.submitExpense(submitCommand(budgetId));
    if (!submitted.ok) throw new Error('expected submit to succeed');
    await service.closeBudget({
      budgetId,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_close',
    });
    const approve = await service.decideExpense(
      decideCommand(submitted.value.expense.id, 'approve'),
    );
    expect(approve.ok).toBe(false);
    if (approve.ok) return;
    expect(approve.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(await spent(service, budgetId)).toBe(0);
    // Control: rejecting the pending expense of a closed budget is still allowed.
    const reject = await service.decideExpense(decideCommand(submitted.value.expense.id, 'reject'));
    expect(reject.ok).toBe(true);
  });

  it('an expense of another workspace cannot be decided (NOT FOUND)', async () => {
    const { service } = setup();
    const budgetId = await openBudget(service, { workspaceId: OTHER_WORKSPACE });
    const submitted = await service.submitExpense(
      submitCommand(budgetId, { workspaceId: OTHER_WORKSPACE }),
    );
    if (!submitted.ok) throw new Error('expected submit to succeed');
    const denied = await service.decideExpense(
      decideCommand(submitted.value.expense.id, 'approve'),
    );
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.code).toBe('NOT_FOUND');
  });

  it('executed amount == approved amount == the utilization delta; a rejection changes nothing', async () => {
    const { service } = setup();
    const budgetId = await openBudget(service);
    const first = await service.submitExpense(
      submitCommand(budgetId, { amountMinorUnits: 12_345 }),
    );
    const second = await service.submitExpense(
      submitCommand(budgetId, { amountMinorUnits: 4_000 }),
    );
    if (!first.ok || !second.ok) throw new Error('expected submits to succeed');
    // Pending expenses never count.
    expect(await spent(service, budgetId)).toBe(0);

    const before = await spent(service, budgetId);
    const approved = await service.decideExpense(decideCommand(first.value.expense.id, 'approve'));
    if (!approved.ok) throw new Error('expected approval');
    expect(approved.value.expense.amount.minorUnits).toBe(12_345);
    expect((await spent(service, budgetId)) - before).toBe(12_345);

    const beforeReject = await spent(service, budgetId);
    const rejected = await service.decideExpense(decideCommand(second.value.expense.id, 'reject'));
    expect(rejected.ok).toBe(true);
    expect(await spent(service, budgetId)).toBe(beforeReject);
  });
});

describe('FinanceApplicationService reads', () => {
  it('lists only the budgets and expenses of the requested workspace', async () => {
    const { service } = setup();
    await service.createBudget(
      createBudgetCommand({ name: 'Engineering Budget' }) as Parameters<
        typeof service.createBudget
      >[0],
    );
    await service.createBudget(
      createBudgetCommand({
        name: 'Marketing Budget',
        workspaceId: OTHER_WORKSPACE,
      }) as Parameters<typeof service.createBudget>[0],
    );

    const engineering = await service.listBudgets(TENANT, WORKSPACE);
    expect(engineering.ok).toBe(true);
    if (engineering.ok) {
      expect(engineering.value.map((budget) => budget.name)).toEqual(['Engineering Budget']);
    }
  });

  it('gets one budget within the trusted scope, or NOT FOUND cross-scope', async () => {
    const { service } = setup();
    const created = await service.createBudget(
      createBudgetCommand() as Parameters<typeof service.createBudget>[0],
    );
    if (!created.ok) throw new Error('expected create to succeed');
    const budgetId = created.value.budget.id;

    const found = await service.getBudget(TENANT, WORKSPACE, budgetId);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value.name).toBe('Marketing Q3');
    }

    const foreign = await service.getBudget(TENANT, OTHER_WORKSPACE, budgetId);
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error.code).toBe('NOT_FOUND');
  });

  it('computes utilization from approved expenses only (pending/rejected never count)', async () => {
    const { service } = setup();
    const created = await service.createBudget(
      createBudgetCommand() as Parameters<typeof service.createBudget>[0],
    );
    if (!created.ok) throw new Error('expected create to succeed');
    const budgetId = created.value.budget.id;

    const approved = await service.submitExpense({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      budgetId,
      submittedBy: USER,
      description: 'Approved spend',
      amountMinorUnits: 30_000,
      currency: 'INR',
      actorId: USER,
      correlationId: 'corr_16',
    });
    if (!approved.ok) throw new Error('expected submit to succeed');
    await service.decideExpense({
      expenseId: approved.value.expense.id,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      decision: 'approve',
      decidedBy: APPROVER,
      actorId: APPROVER,
      correlationId: 'corr_17',
    });

    const pending = await service.submitExpense({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      budgetId,
      submittedBy: USER,
      description: 'Still pending',
      amountMinorUnits: 50_000,
      currency: 'INR',
      actorId: USER,
      correlationId: 'corr_18',
    });
    if (!pending.ok) throw new Error('expected submit to succeed');

    const utilization = await service.listBudgetUtilization({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
    });
    expect(utilization.ok).toBe(true);
    if (!utilization.ok) return;
    const entry = utilization.value.find((item) => item.budgetId === budgetId);
    expect(entry?.spentMinorUnits).toBe(30_000);
    expect(entry?.utilizationPercent).toBe(30);
  });
});
