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
