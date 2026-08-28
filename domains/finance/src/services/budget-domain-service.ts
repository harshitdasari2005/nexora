/**
 * @nexora/module-finance — BudgetDomainService.
 *
 * Orchestrates the {@link Budget} aggregate lifecycle (DOMAIN_MODEL.md
 * §4.4): creation, revision, review flagging/clearing, and closing. Owns the
 * use-case workflows that span the aggregate and its repository; the
 * aggregate enforces its own invariants. All methods return a `Result` so
 * expected failures are explicit values, not exceptions.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import { Budget } from '../entities/budget.js';
import type { FinanceEventContext } from '../events/index.js';
import {
  BudgetNotFoundError,
  toFinanceError,
  type FinanceStateTransitionError,
  type InvalidFinanceValueError,
} from '../errors/index.js';
import type { BudgetRepository } from '../repositories/index.js';
import type { BudgetId } from '../value-objects/budget-id.js';

/** Input for creating a budget. */
export interface CreateBudgetCommand {
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  createdBy: UserId;
  name: string;
  allocatedMinorUnits: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
}

/** Input for revising a budget. */
export interface ReviseBudgetCommand {
  name: string;
  allocatedMinorUnits: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
}

/** The outcome of a budget command: the aggregate plus emitted events. */
export interface BudgetCommandResult {
  budget: Budget;
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link BudgetDomainService}. */
export interface BudgetDomainServiceDependencies {
  budgets: BudgetRepository;
}

/** The budget lifecycle use-case service. */
export class BudgetDomainService {
  readonly #budgets: BudgetRepository;

  constructor(dependencies: BudgetDomainServiceDependencies) {
    this.#budgets = dependencies.budgets;
  }

  /** Creates a budget: validates through the aggregate factory, persists it in `active`. */
  async create(
    input: CreateBudgetCommand,
    context: FinanceEventContext,
  ): Promise<Result<BudgetCommandResult, InvalidFinanceValueError>> {
    try {
      const budget = Budget.create(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          name: input.name,
          allocatedMinorUnits: input.allocatedMinorUnits,
          currency: input.currency,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
        context,
      );
      await this.#budgets.save(budget);
      return ok({ budget, events: budget.pullDomainEvents() });
    } catch (error) {
      return err(toFinanceError(error) as InvalidFinanceValueError);
    }
  }

  /** Revises a budget's name / allocation / period while it is not `closed`. */
  async revise(
    budgetId: BudgetId,
    input: ReviseBudgetCommand,
    context: FinanceEventContext,
  ): Promise<
    Result<
      BudgetCommandResult,
      BudgetNotFoundError | FinanceStateTransitionError | InvalidFinanceValueError
    >
  > {
    try {
      const budget = await this.#requireBudget(budgetId);
      budget.revise(input, context);
      await this.#budgets.save(budget);
      return ok({ budget, events: budget.pullDomainEvents() });
    } catch (error) {
      return err(
        toFinanceError(error) as
          BudgetNotFoundError | FinanceStateTransitionError | InvalidFinanceValueError,
      );
    }
  }

  /** Flags a budget for review (`active` → `under_review`, idempotent). */
  async flagForReview(
    budgetId: BudgetId,
    context: FinanceEventContext,
  ): Promise<Result<BudgetCommandResult, BudgetNotFoundError | FinanceStateTransitionError>> {
    try {
      const budget = await this.#requireBudget(budgetId);
      budget.flagForReview(context);
      await this.#budgets.save(budget);
      return ok({ budget, events: budget.pullDomainEvents() });
    } catch (error) {
      return err(toFinanceError(error) as BudgetNotFoundError | FinanceStateTransitionError);
    }
  }

  /** Clears a budget's review flag (`under_review` → `active`). */
  async clearReview(
    budgetId: BudgetId,
    context: FinanceEventContext,
  ): Promise<Result<BudgetCommandResult, BudgetNotFoundError | FinanceStateTransitionError>> {
    try {
      const budget = await this.#requireBudget(budgetId);
      budget.clearReview(context);
      await this.#budgets.save(budget);
      return ok({ budget, events: budget.pullDomainEvents() });
    } catch (error) {
      return err(toFinanceError(error) as BudgetNotFoundError | FinanceStateTransitionError);
    }
  }

  /** Closes a budget (`active|under_review` → `closed`, terminal). */
  async close(
    budgetId: BudgetId,
    context: FinanceEventContext,
  ): Promise<Result<BudgetCommandResult, BudgetNotFoundError | FinanceStateTransitionError>> {
    try {
      const budget = await this.#requireBudget(budgetId);
      budget.close(context);
      await this.#budgets.save(budget);
      return ok({ budget, events: budget.pullDomainEvents() });
    } catch (error) {
      return err(toFinanceError(error) as BudgetNotFoundError | FinanceStateTransitionError);
    }
  }

  /** Finds a budget by id, or returns a {@link BudgetNotFoundError}. */
  async findById(budgetId: BudgetId): Promise<Result<Budget, BudgetNotFoundError>> {
    const budget = await this.#budgets.findById(budgetId);
    if (budget === undefined) {
      return err(new BudgetNotFoundError({ budgetId }));
    }
    return ok(budget);
  }

  /** Lists the budgets of a workspace (workspace-scoped read). */
  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly Budget[], never>> {
    return ok(await this.#budgets.listByWorkspace(organizationId, workspaceId));
  }

  /** Loads a budget or throws {@link BudgetNotFoundError}. */
  async #requireBudget(budgetId: BudgetId): Promise<Budget> {
    const budget = await this.#budgets.findById(budgetId);
    if (budget === undefined) {
      throw new BudgetNotFoundError({ budgetId });
    }
    return budget;
  }
}
