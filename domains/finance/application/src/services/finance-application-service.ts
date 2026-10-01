/**
 * @nexora/application-finance — FinanceApplicationService.
 *
 * The application layer orchestrator (BACKEND.md §4): it coordinates the
 * BudgetDomainService and ExpenseDomainService, verifies every read/write
 * against the trusted tenant + workspace scope, collects emitted domain
 * events, and publishes them once through the {@link EventPublisher} port.
 * It contains no business rules of its own — every invariant is enforced by
 * the domain.
 *
 * Scope (tenant + workspace) is TRUSTED server-side state: a foreign or
 * cross-workspace id resolves to NOT FOUND, never to another workspace's
 * budget/expense.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { EventPublisher, EventEnvelope } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import {
  BudgetId,
  BudgetNotFoundError,
  ExpenseId,
  ExpenseNotFoundError,
  FinanceStateTransitionError,
  type Budget,
  type BudgetDomainService,
  type Expense,
  type ExpenseDomainService,
  type FinanceEventContext,
} from '@nexora/module-finance';

import type { CreateBudgetCommand, CreateBudgetResult } from '../commands/create-budget.command.js';
import type { ReviseBudgetCommand, ReviseBudgetResult } from '../commands/revise-budget.command.js';
import type { CloseBudgetCommand, CloseBudgetResult } from '../commands/close-budget.command.js';
import type {
  ClearBudgetReviewCommand,
  ClearBudgetReviewResult,
} from '../commands/clear-budget-review.command.js';
import type {
  FlagOverBudgetItemsCommand,
  FlagOverBudgetItemsResult,
} from '../commands/flag-over-budget-items.command.js';
import type {
  SubmitExpenseCommand,
  SubmitExpenseResult,
} from '../commands/submit-expense.command.js';
import type {
  DecideExpenseCommand,
  DecideExpenseResult,
} from '../commands/decide-expense.command.js';
import { toBudgetDto, type BudgetDto } from '../dto/budget.dto.js';
import { toExpenseDto, type ExpenseDto } from '../dto/expense.dto.js';
import type { BudgetUtilizationDto } from '../dto/budget-utilization.dto.js';
import { validateBudgetFields } from '../validators/create-budget.validator.js';
import { validateSubmitExpense } from '../validators/submit-expense.validator.js';

/**
 * The high-utilization threshold the deterministic `FlagOverBudgetItems`
 * remediation action flags against — the SAME numeric threshold the
 * `finance_budget_overrun` detection signal uses for its `high` severity
 * tier (platform/detection/src/seed/initial-signals.ts). The two constants
 * are declared independently (detection signals never depend on a domain
 * module — the same decoupling every other signal already follows) but
 * MUST stay numerically identical: a change here without the matching
 * change there would flag budgets remediation never actually detected as
 * high-risk.
 */
export const BUDGET_HIGH_UTILIZATION_THRESHOLD_PERCENT = 90;

/** Dependencies of the {@link FinanceApplicationService}. */
export interface FinanceApplicationServiceDependencies {
  budgetsService: BudgetDomainService;
  expensesService: ExpenseDomainService;
  publisher: EventPublisher;
}

/**
 * The finance application service. All methods return a `Result` so
 * expected failures are explicit values.
 */
export class FinanceApplicationService {
  readonly #budgetsService: BudgetDomainService;
  readonly #expensesService: ExpenseDomainService;
  readonly #publisher: EventPublisher;

  constructor(dependencies: FinanceApplicationServiceDependencies) {
    this.#budgetsService = dependencies.budgetsService;
    this.#expensesService = dependencies.expensesService;
    this.#publisher = dependencies.publisher;
  }

  /** Creates a budget in `active` status within the trusted tenant + workspace. */
  async createBudget(
    command: CreateBudgetCommand,
  ): Promise<Result<CreateBudgetResult, NexoraError>> {
    try {
      validateBudgetFields(command);
      const context = financeContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
        command.workspaceId,
      );
      const created = await this.#budgetsService.create(
        {
          organizationId: command.organizationId,
          workspaceId: command.workspaceId,
          createdBy: command.createdBy,
          name: command.name,
          allocatedMinorUnits: command.allocatedMinorUnits,
          currency: command.currency,
          periodStart: command.periodStart,
          periodEnd: command.periodEnd,
        },
        context,
      );
      if (!created.ok) {
        return err(created.error);
      }
      await this.#publisher.publish(created.value.events);
      return ok({ budget: created.value.budget, events: created.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected finance application error'));
    }
  }

  /** Revises a budget within the trusted tenant + workspace. */
  async reviseBudget(
    command: ReviseBudgetCommand,
  ): Promise<Result<ReviseBudgetResult, NexoraError>> {
    try {
      validateBudgetFields(command);
      const budgetId = BudgetId.from(command.budgetId);
      await this.#requireVisibleBudget(budgetId, command.organizationId, command.workspaceId);
      const context = financeContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
        command.workspaceId,
      );
      const revised = await this.#budgetsService.revise(
        budgetId,
        {
          name: command.name,
          allocatedMinorUnits: command.allocatedMinorUnits,
          currency: command.currency,
          periodStart: command.periodStart,
          periodEnd: command.periodEnd,
        },
        context,
      );
      if (!revised.ok) {
        return err(revised.error);
      }
      await this.#publisher.publish(revised.value.events);
      return ok({ budget: revised.value.budget, events: revised.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected finance application error'));
    }
  }

  /** Closes a budget within the trusted tenant + workspace. */
  async closeBudget(command: CloseBudgetCommand): Promise<Result<CloseBudgetResult, NexoraError>> {
    try {
      const budgetId = BudgetId.from(command.budgetId);
      await this.#requireVisibleBudget(budgetId, command.organizationId, command.workspaceId);
      const context = financeContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
        command.workspaceId,
      );
      const closed = await this.#budgetsService.close(budgetId, context);
      if (!closed.ok) {
        return err(closed.error);
      }
      await this.#publisher.publish(closed.value.events);
      return ok({ budget: closed.value.budget, events: closed.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected finance application error'));
    }
  }

  /** Clears a budget's review flag within the trusted tenant + workspace. */
  async clearBudgetReview(
    command: ClearBudgetReviewCommand,
  ): Promise<Result<ClearBudgetReviewResult, NexoraError>> {
    try {
      const budgetId = BudgetId.from(command.budgetId);
      await this.#requireVisibleBudget(budgetId, command.organizationId, command.workspaceId);
      const context = financeContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
        command.workspaceId,
      );
      const cleared = await this.#budgetsService.clearReview(budgetId, context);
      if (!cleared.ok) {
        return err(cleared.error);
      }
      await this.#publisher.publish(cleared.value.events);
      return ok({ budget: cleared.value.budget, events: cleared.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected finance application error'));
    }
  }

  /**
   * The deterministic remediation action: re-scans every `active` budget in
   * the trusted workspace, computes utilization the SAME way
   * {@link FinanceApplicationService.listBudgetUtilization} does, and flags
   * every budget at or above {@link BUDGET_HIGH_UTILIZATION_THRESHOLD_PERCENT}
   * for review. Parameterless — the caller (an AI tool or a human) supplies
   * only the trusted scope, never a target list; the threshold is a
   * hard-coded constant, never LLM-decided.
   */
  async flagOverBudgetItems(
    command: FlagOverBudgetItemsCommand,
  ): Promise<Result<FlagOverBudgetItemsResult, NexoraError>> {
    try {
      const utilization = await this.listBudgetUtilization({
        organizationId: command.organizationId,
        workspaceId: command.workspaceId,
      });
      if (!utilization.ok) {
        return err(utilization.error);
      }
      const overThreshold = utilization.value.filter(
        (entry) =>
          entry.status === 'active' &&
          entry.utilizationPercent >= BUDGET_HIGH_UTILIZATION_THRESHOLD_PERCENT,
      );
      const context = financeContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
        command.workspaceId,
      );
      const flagged: Budget[] = [];
      const events: EventEnvelope[] = [];
      for (const entry of overThreshold) {
        const result = await this.#budgetsService.flagForReview(
          BudgetId.from(entry.budgetId),
          context,
        );
        // A budget that changed status between the read above and this
        // write (e.g. a human closed it concurrently) is skipped, not
        // failed — a live re-scan tolerates state that has moved on.
        if (result.ok) {
          flagged.push(result.value.budget);
          events.push(...result.value.events);
        }
      }
      if (events.length > 0) {
        await this.#publisher.publish(events);
      }
      return ok({ flagged, events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected finance application error'));
    }
  }

  /** Lists the budgets of a workspace (workspace-scoped read). */
  async listBudgets(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly BudgetDto[], never>> {
    const listed = await this.#budgetsService.listByWorkspace(organizationId, workspaceId);
    if (!listed.ok) {
      return err(listed.error);
    }
    return ok(listed.value.map((budget) => toBudgetDto(budget)));
  }

  /** Reads one budget within the trusted tenant + workspace, or NOT FOUND. */
  async getBudget(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
    budgetIdInput: string,
  ): Promise<Result<BudgetDto, NexoraError>> {
    try {
      const budgetId = BudgetId.from(budgetIdInput);
      const budget = await this.#requireVisibleBudget(budgetId, organizationId, workspaceId);
      return ok(toBudgetDto(budget));
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected finance application error'));
    }
  }

  /**
   * Computes the utilization of every budget in a workspace (see
   * {@link BUDGET_HIGH_UTILIZATION_THRESHOLD_PERCENT}'s doc comment — this is
   * the single source of truth every other consumer reads).
   */
  async listBudgetUtilization(query: {
    organizationId: TenantId;
    workspaceId: WorkspaceId;
  }): Promise<Result<readonly BudgetUtilizationDto[], never>> {
    const listed = await this.#budgetsService.listByWorkspace(
      query.organizationId,
      query.workspaceId,
    );
    if (!listed.ok) {
      return err(listed.error);
    }
    const utilization: BudgetUtilizationDto[] = [];
    for (const budget of listed.value) {
      const approved = await this.#expensesService.listApprovedByBudget(
        query.organizationId,
        budget.id,
      );
      const spentMinorUnits = approved.ok
        ? approved.value.reduce((sum, expense) => sum + expense.amount.minorUnits, 0)
        : 0;
      const allocatedMinorUnits = budget.allocated.minorUnits;
      const utilizationPercent =
        allocatedMinorUnits > 0 ? Math.round((spentMinorUnits / allocatedMinorUnits) * 100) : 0;
      utilization.push({
        budgetId: budget.id,
        name: budget.name.value,
        currency: budget.allocated.currency,
        allocatedMinorUnits,
        spentMinorUnits,
        utilizationPercent,
        status: budget.status.value,
      });
    }
    return ok(utilization);
  }

  /** Submits an expense within the trusted tenant + workspace. */
  async submitExpense(
    command: SubmitExpenseCommand,
  ): Promise<Result<SubmitExpenseResult, NexoraError>> {
    try {
      validateSubmitExpense(command);
      const budgetId = BudgetId.from(command.budgetId);
      const budget = await this.#requireVisibleBudget(
        budgetId,
        command.organizationId,
        command.workspaceId,
      );
      if (budget.status.isTerminal()) {
        return err(
          new FinanceStateTransitionError('Cannot submit an expense against a closed budget', {
            budgetId: budget.id,
            status: budget.status.value,
          }),
        );
      }
      // An expense is denominated in its budget's currency: a mismatch would
      // silently mix currencies in the budget's utilization (a sum of minor units).
      if (command.currency !== budget.allocated.currency) {
        return err(
          new FinanceStateTransitionError('The expense currency must match the budget currency', {
            budgetId: budget.id,
            budgetCurrency: budget.allocated.currency,
            expenseCurrency: command.currency,
          }),
        );
      }
      const context = financeContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
        command.workspaceId,
      );
      const submitted = await this.#expensesService.submit(
        {
          organizationId: command.organizationId,
          workspaceId: command.workspaceId,
          budgetId,
          submittedBy: command.submittedBy,
          description: command.description,
          amountMinorUnits: command.amountMinorUnits,
          currency: command.currency,
        },
        context,
      );
      if (!submitted.ok) {
        return err(submitted.error);
      }
      await this.#publisher.publish(submitted.value.events);
      return ok({ expense: submitted.value.expense, events: submitted.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected finance application error'));
    }
  }

  /** Decides a pending expense within the trusted tenant + workspace. */
  async decideExpense(
    command: DecideExpenseCommand,
  ): Promise<Result<DecideExpenseResult, NexoraError>> {
    try {
      const expenseId = ExpenseId.from(command.expenseId);
      const expense = await this.#requireVisibleExpense(
        expenseId,
        command.organizationId,
        command.workspaceId,
      );
      const context = financeContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
        command.workspaceId,
      );
      if (command.decision === 'approve') {
        // Approving moves money against the budget NOW: the budget must still
        // be in the trusted scope and open (it may have been closed after the
        // expense was submitted). A foreign/missing budget is NOT FOUND.
        const budget = await this.#requireVisibleBudget(
          expense.budgetId,
          command.organizationId,
          command.workspaceId,
        );
        if (budget.status.isTerminal()) {
          return err(
            new FinanceStateTransitionError('Cannot approve an expense against a closed budget', {
              budgetId: budget.id,
              status: budget.status.value,
            }),
          );
        }
      }
      const decided =
        command.decision === 'approve'
          ? await this.#expensesService.approve(expense.id, command.decidedBy, context)
          : await this.#expensesService.reject(expense.id, command.decidedBy, context);
      if (!decided.ok) {
        return err(decided.error);
      }
      await this.#publisher.publish(decided.value.events);
      return ok({ expense: decided.value.expense, events: decided.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected finance application error'));
    }
  }

  /** Lists the expenses of a workspace (workspace-scoped read). */
  async listExpenses(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly ExpenseDto[], never>> {
    const listed = await this.#expensesService.listByWorkspace(organizationId, workspaceId);
    if (!listed.ok) {
      return err(listed.error);
    }
    return ok(listed.value.map((expense) => toExpenseDto(expense)));
  }

  /** Reads one expense within the trusted tenant + workspace, or NOT FOUND. */
  async getExpense(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
    expenseIdInput: string,
  ): Promise<Result<ExpenseDto, NexoraError>> {
    try {
      const expenseId = ExpenseId.from(expenseIdInput);
      const expense = await this.#requireVisibleExpense(expenseId, organizationId, workspaceId);
      return ok(toExpenseDto(expense));
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected finance application error'));
    }
  }

  /** Loads a budget and asserts it belongs to the trusted tenant + workspace. */
  async #requireVisibleBudget(
    budgetId: BudgetId,
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Budget> {
    const found = await this.#budgetsService.findById(budgetId);
    if (!found.ok) {
      throw new BudgetNotFoundError({ budgetId });
    }
    if (found.value.organizationId !== organizationId || found.value.workspaceId !== workspaceId) {
      // Foreign / cross-workspace budgets are invisible: same NOT FOUND
      // outcome as a missing id (no data leak).
      throw new BudgetNotFoundError({ budgetId });
    }
    return found.value;
  }

  /** Loads an expense and asserts it belongs to the trusted tenant + workspace. */
  async #requireVisibleExpense(
    expenseId: ReturnType<typeof ExpenseId.from>,
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Expense> {
    const found = await this.#expensesService.findById(expenseId);
    if (!found.ok) {
      throw new ExpenseNotFoundError({ expenseId });
    }
    if (found.value.organizationId !== organizationId || found.value.workspaceId !== workspaceId) {
      throw new ExpenseNotFoundError({ expenseId });
    }
    return found.value;
  }
}

/** Builds a Finance event context (tenant + workspace known to caller). */
function financeContext(
  actorId: string,
  correlationId: string,
  organizationId: TenantId,
  workspaceId: WorkspaceId,
): FinanceEventContext {
  return {
    actor: { kind: 'user', id: actorId },
    correlationId,
    organizationId,
    workspaceId,
  };
}
