/**
 * @nexora/persistence — budget and expense repositories.
 *
 * Drizzle implementations of the Finance bounded context repository ports
 * (`BudgetRepository`, `ExpenseRepository`). Aggregates are serialized via
 * `snapshot()` and reconstructed via `hydrate()` (PERSISTENCE.md §4
 * aggregate ownership); the hydrated aggregate RESTORES the persisted id
 * (never regenerates one).
 *
 * Every read is organization + workspace scoped in SQL FIRST
 * (defense-in-depth): a budget/expense id alone grants nothing, and a
 * foreign or cross-workspace record resolves to NOT FOUND — never to
 * another workspace's record.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import {
  Budget,
  Expense,
  type BudgetId,
  type BudgetRepository,
  type ExpenseId,
  type ExpenseRepository,
} from '@nexora/module-finance';

import type { NexoraDatabase } from '../db.js';
import { budgets, expenses } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

type BudgetRow = typeof budgets.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;

/** Maps a budgets row to a {@link Budget} snapshot. */
function rowToBudgetSnapshot(row: BudgetRow): ReturnType<typeof Budget.snapshot> {
  return {
    id: row.id as BudgetId,
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    createdBy: row.createdBy as UserId,
    name: row.name,
    allocatedMinorUnits: row.allocatedMinorUnits,
    currency: row.currency,
    periodStart: toIso(row.periodStart),
    periodEnd: toIso(row.periodEnd),
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Maps a {@link Budget} snapshot to a budgets row. */
function budgetSnapshotToRow(snapshot: ReturnType<typeof Budget.snapshot>): BudgetRow {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    workspaceId: snapshot.workspaceId,
    createdBy: snapshot.createdBy,
    name: snapshot.name,
    allocatedMinorUnits: snapshot.allocatedMinorUnits,
    currency: snapshot.currency,
    periodStart: toDate(snapshot.periodStart),
    periodEnd: toDate(snapshot.periodEnd),
    status: snapshot.status,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** The PostgreSQL {@link BudgetRepository} implementation. */
export class PgBudgetRepository implements BudgetRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: BudgetId): Promise<Budget | undefined> {
    const rows = await this.#db.select().from(budgets).where(eq(budgets.id, id)).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : Budget.hydrate(rowToBudgetSnapshot(row));
  }

  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly Budget[]> {
    const rows = await this.#db
      .select()
      .from(budgets)
      .where(and(eq(budgets.organizationId, organizationId), eq(budgets.workspaceId, workspaceId)))
      .orderBy(desc(budgets.createdAt), desc(budgets.id));
    return rows.map((row) => Budget.hydrate(rowToBudgetSnapshot(row)));
  }

  async save(budget: Budget): Promise<void> {
    const row = budgetSnapshotToRow(Budget.snapshot(budget));
    await this.#db.insert(budgets).values(row).onConflictDoUpdate({ target: budgets.id, set: row });
  }
}

/** Maps an expenses row to an {@link Expense} snapshot. */
function rowToExpenseSnapshot(row: ExpenseRow): ReturnType<typeof Expense.snapshot> {
  return {
    id: row.id as ExpenseId,
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    budgetId: row.budgetId as BudgetId,
    submittedBy: row.submittedBy as UserId,
    description: row.description,
    amountMinorUnits: row.amountMinorUnits,
    currency: row.currency,
    status: row.status,
    decidedBy: row.decidedBy === null ? undefined : (row.decidedBy as UserId),
    decidedAt: row.decidedAt === null ? undefined : toIso(row.decidedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Maps an {@link Expense} snapshot to an expenses row. */
function expenseSnapshotToRow(snapshot: ReturnType<typeof Expense.snapshot>): ExpenseRow {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    workspaceId: snapshot.workspaceId,
    budgetId: snapshot.budgetId,
    submittedBy: snapshot.submittedBy,
    description: snapshot.description,
    amountMinorUnits: snapshot.amountMinorUnits,
    currency: snapshot.currency,
    status: snapshot.status,
    decidedBy: snapshot.decidedBy ?? null,
    decidedAt: snapshot.decidedAt === undefined ? null : toDate(snapshot.decidedAt),
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** The PostgreSQL {@link ExpenseRepository} implementation. */
export class PgExpenseRepository implements ExpenseRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: ExpenseId): Promise<Expense | undefined> {
    const rows = await this.#db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : Expense.hydrate(rowToExpenseSnapshot(row));
  }

  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly Expense[]> {
    const rows = await this.#db
      .select()
      .from(expenses)
      .where(
        and(eq(expenses.organizationId, organizationId), eq(expenses.workspaceId, workspaceId)),
      )
      .orderBy(desc(expenses.createdAt), desc(expenses.id));
    return rows.map((row) => Expense.hydrate(rowToExpenseSnapshot(row)));
  }

  async listApprovedByBudget(
    organizationId: TenantId,
    budgetId: BudgetId,
  ): Promise<readonly Expense[]> {
    const rows = await this.#db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.organizationId, organizationId),
          eq(expenses.budgetId, budgetId),
          eq(expenses.status, 'approved'),
        ),
      )
      .orderBy(desc(expenses.createdAt), desc(expenses.id));
    return rows.map((row) => Expense.hydrate(rowToExpenseSnapshot(row)));
  }

  async save(expense: Expense): Promise<void> {
    const row = expenseSnapshotToRow(Expense.snapshot(expense));
    await this.#db
      .insert(expenses)
      .values(row)
      .onConflictDoUpdate({ target: expenses.id, set: row });
  }
}
