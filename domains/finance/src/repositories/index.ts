/**
 * @nexora/module-finance — repository interfaces.
 *
 * The persistence ports of the Finance bounded context (BACKEND.md §2
 * dependency direction; PERSISTENCE.md §4 aggregate ownership). The domain
 * depends on these interfaces; the infrastructure layer (PostgreSQL/Drizzle)
 * implements them. No ORM, no SQL, no persistence here.
 *
 * Every read is scope-bound: the workspace is always part of the query, so
 * a budget/expense id alone grants nothing (a foreign or cross-workspace id
 * resolves to NOT FOUND — never to another workspace's record). No DB-level
 * foreign key links `expenses.budgetId` to `budgets.id` (PERSISTENCE.md: one
 * table per aggregate root, cross-aggregate integrity is an application-
 * layer concern) — the application layer verifies the referenced budget
 * exists and is in scope before an expense is submitted against it.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { Budget } from '../entities/budget.js';
import type { Expense } from '../entities/expense.js';
import type { BudgetId } from '../value-objects/budget-id.js';
import type { ExpenseId } from '../value-objects/expense-id.js';

/** The persistence port of the {@link Budget} aggregate. */
export interface BudgetRepository {
  /** Loads a budget by id, or `undefined` when it does not exist. */
  findById(id: BudgetId): Promise<Budget | undefined>;

  /** Lists the budgets of a workspace, newest first (workspace-scoped read). */
  listByWorkspace(organizationId: TenantId, workspaceId: WorkspaceId): Promise<readonly Budget[]>;

  /** Persists the aggregate (insert or update by id). */
  save(budget: Budget): Promise<void>;
}

/** The persistence port of the {@link Expense} aggregate. */
export interface ExpenseRepository {
  /** Loads an expense by id, or `undefined` when it does not exist. */
  findById(id: ExpenseId): Promise<Expense | undefined>;

  /** Lists the expenses of a workspace, newest first (workspace-scoped read). */
  listByWorkspace(organizationId: TenantId, workspaceId: WorkspaceId): Promise<readonly Expense[]>;

  /**
   * Lists the APPROVED expenses claimed against a budget (the utilization
   * projection's source of truth — pending/rejected expenses never count as
   * spend).
   */
  listApprovedByBudget(organizationId: TenantId, budgetId: BudgetId): Promise<readonly Expense[]>;

  /** Persists the aggregate (insert or update by id). */
  save(expense: Expense): Promise<void>;
}
