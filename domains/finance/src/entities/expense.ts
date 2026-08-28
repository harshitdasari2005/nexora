/**
 * @nexora/module-finance — Expense aggregate root.
 *
 * A single expense claim against a {@link Budget} (DOMAIN_MODEL.md §4.4
 * Finance: `Expense`), owned by exactly one organization and workspace,
 * submitted by exactly one user (the `submittedBy`, immutable), referencing
 * exactly one budget (the `budgetId`, immutable — BR-5-style invariant: "an
 * Expense shall reference an existing budget", mirroring the Invoice→
 * customer rule for the same reason: money without a scope is meaningless).
 *
 * Lifecycle: `pending → approved | rejected` (both terminal — BR-19: money
 * movements are Consequential and always require human approval; a decision
 * is never revised). Only `approved` expenses count as committed spend
 * against their budget (computed read-side, never stored here — see
 * {@link Budget}'s doc comment).
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import type { FinanceEventContext } from '../events/index.js';
import {
  expenseApprovedEvent,
  expenseRejectedEvent,
  expenseSubmittedEvent,
} from '../events/index.js';
import { ExpenseSelfApprovalError, FinanceStateTransitionError } from '../errors/index.js';
import { EXPENSE_TRANSITIONS } from '../policies/index.js';
import type { BudgetId } from '../value-objects/budget-id.js';
import { BudgetId as BudgetIdFactory } from '../value-objects/budget-id.js';
import type { ExpenseId } from '../value-objects/expense-id.js';
import { ExpenseId as ExpenseIdFactory } from '../value-objects/expense-id.js';
import { ExpenseDescription } from '../value-objects/expense-description.js';
import { ExpenseStatus } from '../value-objects/expense-status.js';
import { Money } from '../value-objects/money.js';

/** Input for submitting a new {@link Expense}. */
export interface SubmitExpenseInput {
  /** The owning organization (tenant) id — immutable. */
  organizationId: TenantId;
  /** The owning workspace id — immutable (workspace isolation). */
  workspaceId: WorkspaceId;
  /** The budget this expense is claimed against — immutable. */
  budgetId: BudgetId;
  /** The user that submits the expense — immutable. */
  submittedBy: UserId;
  /** The expense description (validated). */
  description: string;
  /** The claimed amount, in minor units. */
  amountMinorUnits: number;
  /** The three-letter currency code. */
  currency: string;
}

/** A persistence snapshot of the {@link Expense} aggregate. */
export interface ExpenseSnapshot {
  id: ExpenseId;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  budgetId: BudgetId;
  submittedBy: UserId;
  description: string;
  amountMinorUnits: number;
  currency: string;
  status: string;
  decidedBy: UserId | undefined;
  decidedAt: string | undefined;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * The {@link Expense} aggregate root. Use {@link Expense.submit} to
 * construct; mutate only through aggregate methods so invariants stay
 * protected.
 */
export class Expense {
  #id: ExpenseId;
  readonly #organizationId: TenantId;
  readonly #workspaceId: WorkspaceId;
  readonly #budgetId: BudgetId;
  readonly #submittedBy: UserId;
  readonly #description: ExpenseDescription;
  readonly #amount: Money;
  #status: ExpenseStatus;
  #decidedBy: UserId | undefined;
  #decidedAt: string | undefined;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: SubmitExpenseInput, createdAt: string) {
    this.#id = ExpenseIdFactory.create();
    this.#organizationId = input.organizationId;
    this.#workspaceId = input.workspaceId;
    this.#budgetId = BudgetIdFactory.from(input.budgetId);
    this.#submittedBy = input.submittedBy;
    this.#description = ExpenseDescription.create(input.description);
    this.#amount = Money.create(input.amountMinorUnits, input.currency);
    this.#status = ExpenseStatus.pending();
    this.#decidedBy = undefined;
    this.#decidedAt = undefined;
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Submits a new {@link Expense} in `pending` status and records an
   * {@link expenseSubmittedEvent}.
   */
  static submit(input: SubmitExpenseInput, context: FinanceEventContext, now = nowIso()): Expense {
    const expense = new Expense(input, now);
    expense.#events.push(
      expenseSubmittedEvent(context, {
        expenseId: expense.#id,
        budgetId: expense.#budgetId,
        organizationId: expense.#organizationId,
        workspaceId: expense.#workspaceId,
        submittedBy: expense.#submittedBy,
        amountMinorUnits: expense.#amount.minorUnits,
        currency: expense.#amount.currency,
        status: expense.#status.value,
      }),
    );
    return expense;
  }

  /** The expense id. */
  get id(): ExpenseId {
    return this.#id;
  }

  /** The owning organization (tenant) id. */
  get organizationId(): TenantId {
    return this.#organizationId;
  }

  /** The owning workspace id. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The budget this expense is claimed against. */
  get budgetId(): BudgetId {
    return this.#budgetId;
  }

  /** The user that submitted the expense. */
  get submittedBy(): UserId {
    return this.#submittedBy;
  }

  /** The expense description. */
  get description(): ExpenseDescription {
    return this.#description;
  }

  /** The claimed amount. */
  get amount(): Money {
    return this.#amount;
  }

  /** The lifecycle status. */
  get status(): ExpenseStatus {
    return this.#status;
  }

  /** The user that decided the expense, once decided. */
  get decidedBy(): UserId | undefined {
    return this.#decidedBy;
  }

  /** ISO-8601 UTC time the expense was decided, once decided. */
  get decidedAt(): string | undefined {
    return this.#decidedAt;
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time of the last mutation. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version for optimistic concurrency (EntityMeta). */
  get version(): number {
    return this.#version;
  }

  /**
   * Approves the expense (`pending` → `approved`, terminal — BR-19 money
   * movement) and records an {@link expenseApprovedEvent}.
   *
   * Segregation of duties (PRD §14.3.3, FR-21): the approver must not be the
   * submitter. This is enforced in the aggregate so no execution path
   * (REST, AI tool, MCP, workflow) can bypass it.
   *
   * @throws {ExpenseSelfApprovalError} when `decidedBy` is the submitter.
   * @throws {FinanceStateTransitionError} when the expense is not `pending`.
   */
  approve(decidedBy: UserId, context: FinanceEventContext, now = nowIso()): void {
    if (decidedBy === this.#submittedBy) {
      throw new ExpenseSelfApprovalError({ expenseId: this.#id, submittedBy: this.#submittedBy });
    }
    this.#decide(ExpenseStatus.approved(), decidedBy, now);
    this.#events.push(
      expenseApprovedEvent(context, {
        expenseId: this.#id,
        budgetId: this.#budgetId,
        decidedBy,
        status: this.#status.value,
      }),
    );
  }

  /**
   * Rejects the expense (`pending` → `rejected`, terminal) and records an
   * {@link expenseRejectedEvent}.
   *
   * @throws {FinanceStateTransitionError} when the expense is not `pending`.
   */
  reject(decidedBy: UserId, context: FinanceEventContext, now = nowIso()): void {
    this.#decide(ExpenseStatus.rejected(), decidedBy, now);
    this.#events.push(
      expenseRejectedEvent(context, {
        expenseId: this.#id,
        budgetId: this.#budgetId,
        decidedBy,
        status: this.#status.value,
      }),
    );
  }

  /** Produces a persistence snapshot of the expense (PERSISTENCE.md §4). */
  static snapshot(expense: Expense): ExpenseSnapshot {
    return {
      id: expense.id,
      organizationId: expense.organizationId,
      workspaceId: expense.workspaceId,
      budgetId: expense.budgetId,
      submittedBy: expense.submittedBy,
      description: expense.description.value,
      amountMinorUnits: expense.amount.minorUnits,
      currency: expense.amount.currency,
      status: expense.status.value,
      decidedBy: expense.decidedBy,
      decidedAt: expense.decidedAt,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      version: expense.version,
    };
  }

  /**
   * Reconstructs an {@link Expense} from a persistence snapshot without
   * emitting domain events (DDD reconstitution factory).
   */
  static hydrate(snapshot: ExpenseSnapshot): Expense {
    const expense = new Expense(
      {
        organizationId: snapshot.organizationId,
        workspaceId: snapshot.workspaceId,
        budgetId: snapshot.budgetId,
        submittedBy: snapshot.submittedBy,
        description: snapshot.description,
        amountMinorUnits: snapshot.amountMinorUnits,
        currency: snapshot.currency,
      },
      snapshot.createdAt,
    );
    expense.#id = snapshot.id;
    expense.#status = ExpenseStatus.from(snapshot.status);
    expense.#decidedBy = snapshot.decidedBy;
    expense.#decidedAt = snapshot.decidedAt;
    expense.#updatedAt = snapshot.updatedAt;
    expense.#version = snapshot.version;
    return expense;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Applies a validated decision transition (policy check → mutate). */
  #decide(target: ExpenseStatus, decidedBy: UserId, now: string): void {
    const allowed = EXPENSE_TRANSITIONS[this.#status.value];
    if (!allowed.includes(target.value)) {
      throw new FinanceStateTransitionError(
        `Cannot transition an expense from ${this.#status.value} to ${target.value}`,
        { expenseId: this.#id, from: this.#status.value, to: target.value },
      );
    }
    this.#status = target;
    this.#decidedBy = decidedBy;
    this.#decidedAt = now;
    this.#version += 1;
    this.#updatedAt = now;
  }
}
