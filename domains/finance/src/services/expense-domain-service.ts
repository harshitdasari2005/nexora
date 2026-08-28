/**
 * @nexora/module-finance — ExpenseDomainService.
 *
 * Orchestrates the {@link Expense} aggregate lifecycle (DOMAIN_MODEL.md
 * §4.4): submission and decision (approve/reject). Owns the use-case
 * workflows that span the aggregate and its repository; the aggregate
 * enforces its own invariants. All methods return a `Result` so expected
 * failures are explicit values, not exceptions.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import { Expense } from '../entities/expense.js';
import type { FinanceEventContext } from '../events/index.js';
import {
  ExpenseNotFoundError,
  toFinanceError,
  type FinanceStateTransitionError,
  type InvalidFinanceValueError,
} from '../errors/index.js';
import type { ExpenseRepository } from '../repositories/index.js';
import type { BudgetId } from '../value-objects/budget-id.js';
import type { ExpenseId } from '../value-objects/expense-id.js';

/** Input for submitting an expense. */
export interface SubmitExpenseCommand {
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  budgetId: BudgetId;
  submittedBy: UserId;
  description: string;
  amountMinorUnits: number;
  currency: string;
}

/** The outcome of an expense command: the aggregate plus emitted events. */
export interface ExpenseCommandResult {
  expense: Expense;
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link ExpenseDomainService}. */
export interface ExpenseDomainServiceDependencies {
  expenses: ExpenseRepository;
}

/** The expense lifecycle use-case service. */
export class ExpenseDomainService {
  readonly #expenses: ExpenseRepository;

  constructor(dependencies: ExpenseDomainServiceDependencies) {
    this.#expenses = dependencies.expenses;
  }

  /** Submits an expense: validates through the aggregate factory, persists it `pending`. */
  async submit(
    input: SubmitExpenseCommand,
    context: FinanceEventContext,
  ): Promise<Result<ExpenseCommandResult, InvalidFinanceValueError>> {
    try {
      const expense = Expense.submit(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          budgetId: input.budgetId,
          submittedBy: input.submittedBy,
          description: input.description,
          amountMinorUnits: input.amountMinorUnits,
          currency: input.currency,
        },
        context,
      );
      await this.#expenses.save(expense);
      return ok({ expense, events: expense.pullDomainEvents() });
    } catch (error) {
      return err(toFinanceError(error) as InvalidFinanceValueError);
    }
  }

  /** Approves an expense (`pending` → `approved`, terminal — BR-19 money movement). */
  async approve(
    expenseId: ExpenseId,
    decidedBy: UserId,
    context: FinanceEventContext,
  ): Promise<Result<ExpenseCommandResult, ExpenseNotFoundError | FinanceStateTransitionError>> {
    try {
      const expense = await this.#requireExpense(expenseId);
      expense.approve(decidedBy, context);
      await this.#expenses.save(expense);
      return ok({ expense, events: expense.pullDomainEvents() });
    } catch (error) {
      return err(toFinanceError(error) as ExpenseNotFoundError | FinanceStateTransitionError);
    }
  }

  /** Rejects an expense (`pending` → `rejected`, terminal). */
  async reject(
    expenseId: ExpenseId,
    decidedBy: UserId,
    context: FinanceEventContext,
  ): Promise<Result<ExpenseCommandResult, ExpenseNotFoundError | FinanceStateTransitionError>> {
    try {
      const expense = await this.#requireExpense(expenseId);
      expense.reject(decidedBy, context);
      await this.#expenses.save(expense);
      return ok({ expense, events: expense.pullDomainEvents() });
    } catch (error) {
      return err(toFinanceError(error) as ExpenseNotFoundError | FinanceStateTransitionError);
    }
  }

  /** Finds an expense by id, or returns an {@link ExpenseNotFoundError}. */
  async findById(expenseId: ExpenseId): Promise<Result<Expense, ExpenseNotFoundError>> {
    const expense = await this.#expenses.findById(expenseId);
    if (expense === undefined) {
      return err(new ExpenseNotFoundError({ expenseId }));
    }
    return ok(expense);
  }

  /** Lists the expenses of a workspace (workspace-scoped read). */
  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly Expense[], never>> {
    return ok(await this.#expenses.listByWorkspace(organizationId, workspaceId));
  }

  /** Lists the approved expenses claimed against a budget (utilization source). */
  async listApprovedByBudget(
    organizationId: TenantId,
    budgetId: BudgetId,
  ): Promise<Result<readonly Expense[], never>> {
    return ok(await this.#expenses.listApprovedByBudget(organizationId, budgetId));
  }

  /** Loads an expense or throws {@link ExpenseNotFoundError}. */
  async #requireExpense(expenseId: ExpenseId): Promise<Expense> {
    const expense = await this.#expenses.findById(expenseId);
    if (expense === undefined) {
      throw new ExpenseNotFoundError({ expenseId });
    }
    return expense;
  }
}
