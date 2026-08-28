/**
 * @nexora/module-finance — Budget aggregate root.
 *
 * A financial allocation for a period (DOMAIN_MODEL.md §4.4 Finance:
 * `Budget`), owned by exactly one organization (the `organizationId`,
 * immutable) and one workspace (the `workspaceId`, immutable), created by
 * exactly one user (the `createdBy`, immutable), with a name, an allocated
 * {@link Money} amount, a {@link BudgetPeriod}, and a lifecycle
 * (`active → under_review → active`, `active|under_review → closed`
 * terminal — see {@link BudgetLifecyclePolicy}).
 *
 * "Spent" is NOT stored on the aggregate: it is a computed read-side
 * projection over approved {@link Expense}s referencing this budget (the
 * finance application layer's `listBudgetUtilization` query is the single
 * place that computation happens — never duplicated). This keeps the
 * Budget aggregate's own invariants simple and avoids a dual-write
 * consistency problem between two aggregates.
 *
 * All state changes flow through aggregate methods, which enforce business
 * invariants and record domain events. No partial aggregate mutation on
 * validation failure: transitions validate the policy FIRST, then mutate,
 * then emit the event.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import type { FinanceEventContext } from '../events/index.js';
import {
  budgetClosedEvent,
  budgetCreatedEvent,
  budgetFlaggedForReviewEvent,
  budgetRevisedEvent,
  budgetReviewClearedEvent,
} from '../events/index.js';
import { FinanceStateTransitionError } from '../errors/index.js';
import { BUDGET_TRANSITIONS } from '../policies/index.js';
import type { BudgetId } from '../value-objects/budget-id.js';
import { BudgetId as BudgetIdFactory } from '../value-objects/budget-id.js';
import { BudgetName } from '../value-objects/budget-name.js';
import { BudgetPeriod } from '../value-objects/budget-period.js';
import { BudgetStatus } from '../value-objects/budget-status.js';
import { Money } from '../value-objects/money.js';

/** Input for creating a new {@link Budget}. */
export interface CreateBudgetInput {
  /** The owning organization (tenant) id — immutable. */
  organizationId: TenantId;
  /** The owning workspace id — immutable (workspace isolation). */
  workspaceId: WorkspaceId;
  /** The user that creates the budget (the owner) — immutable. */
  createdBy: UserId;
  /** The budget name (validated). */
  name: string;
  /** The allocated amount, in minor units. */
  allocatedMinorUnits: number;
  /** The three-letter currency code. */
  currency: string;
  /** ISO-8601 UTC period start instant. */
  periodStart: string;
  /** ISO-8601 UTC period end instant. */
  periodEnd: string;
}

/** A persistence snapshot of the {@link Budget} aggregate. */
export interface BudgetSnapshot {
  id: BudgetId;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  createdBy: UserId;
  name: string;
  allocatedMinorUnits: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * The {@link Budget} aggregate root. Use {@link Budget.create} to construct;
 * mutate only through aggregate methods so invariants stay protected.
 */
export class Budget {
  #id: BudgetId;
  readonly #organizationId: TenantId;
  readonly #workspaceId: WorkspaceId;
  readonly #createdBy: UserId;
  #name: BudgetName;
  #allocated: Money;
  #period: BudgetPeriod;
  #status: BudgetStatus;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateBudgetInput, createdAt: string) {
    this.#id = BudgetIdFactory.create();
    this.#organizationId = input.organizationId;
    this.#workspaceId = input.workspaceId;
    this.#createdBy = input.createdBy;
    this.#name = BudgetName.create(input.name);
    this.#allocated = Money.create(input.allocatedMinorUnits, input.currency);
    this.#period = BudgetPeriod.create(input.periodStart, input.periodEnd);
    this.#status = BudgetStatus.active();
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link Budget} in `active` status and records a
   * {@link budgetCreatedEvent}.
   */
  static create(input: CreateBudgetInput, context: FinanceEventContext, now = nowIso()): Budget {
    const budget = new Budget(input, now);
    budget.#events.push(
      budgetCreatedEvent(context, {
        budgetId: budget.#id,
        name: budget.#name.value,
        organizationId: budget.#organizationId,
        workspaceId: budget.#workspaceId,
        createdBy: budget.#createdBy,
        allocatedMinorUnits: budget.#allocated.minorUnits,
        currency: budget.#allocated.currency,
        status: budget.#status.value,
      }),
    );
    return budget;
  }

  /** The budget id. */
  get id(): BudgetId {
    return this.#id;
  }

  /** The owning organization (tenant) id — immutable (exactly one org). */
  get organizationId(): TenantId {
    return this.#organizationId;
  }

  /** The owning workspace id — immutable (workspace isolation). */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The user that created the budget (the owner). */
  get createdBy(): UserId {
    return this.#createdBy;
  }

  /** The budget name. */
  get name(): BudgetName {
    return this.#name;
  }

  /** The allocated amount. */
  get allocated(): Money {
    return this.#allocated;
  }

  /** The period the budget covers. */
  get period(): BudgetPeriod {
    return this.#period;
  }

  /** The lifecycle status. */
  get status(): BudgetStatus {
    return this.#status;
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
   * Revises the budget's name / allocated amount / period while it is not
   * `closed` and records a {@link budgetRevisedEvent}. The owner and scope
   * never change — only the business content. Revising does NOT clear a
   * `under_review` flag: the flag is a real signal about the CURRENT
   * numbers, not the identity of the budget — clearing it is a deliberate,
   * separate act ({@link Budget.clearReview}).
   *
   * @throws {FinanceStateTransitionError} when the budget is closed.
   */
  revise(
    input: {
      name: string;
      allocatedMinorUnits: number;
      currency: string;
      periodStart: string;
      periodEnd: string;
    },
    context: FinanceEventContext,
    now = nowIso(),
  ): void {
    this.#assertMutable('revise');
    const nextName = BudgetName.create(input.name);
    const nextAllocated = Money.create(input.allocatedMinorUnits, input.currency);
    const nextPeriod = BudgetPeriod.create(input.periodStart, input.periodEnd);
    this.#name = nextName;
    this.#allocated = nextAllocated;
    this.#period = nextPeriod;
    this.#bump(now);
    this.#events.push(
      budgetRevisedEvent(context, {
        budgetId: this.#id,
        name: nextName.value,
        allocatedMinorUnits: nextAllocated.minorUnits,
        currency: nextAllocated.currency,
      }),
    );
  }

  /**
   * Flags the budget for review (`active` → `under_review`) — the
   * deterministic remediation transition (never called on a model's say-so;
   * called only after the detection signal's own threshold re-check at
   * execution time). Idempotent no-op when already `under_review` (a
   * re-scan finding the same budget still over threshold is not an error).
   *
   * @throws {FinanceStateTransitionError} when the budget is closed.
   */
  flagForReview(context: FinanceEventContext, now = nowIso()): void {
    if (this.#status.value === 'under_review') {
      return;
    }
    this.#transition(BudgetStatus.underReview(), now);
    this.#events.push(budgetFlaggedForReviewEvent(context, this.#id));
  }

  /**
   * Clears a budget's review flag (`under_review` → `active`) — a human
   * decision that the current numbers are acceptable.
   *
   * @throws {FinanceStateTransitionError} when the budget is not `under_review`.
   */
  clearReview(context: FinanceEventContext, now = nowIso()): void {
    this.#transition(BudgetStatus.active(), now);
    this.#events.push(budgetReviewClearedEvent(context, this.#id));
  }

  /**
   * Closes the budget (`active|under_review` → `closed` — terminal).
   *
   * @throws {FinanceStateTransitionError} when the budget is already closed.
   */
  close(context: FinanceEventContext, now = nowIso()): void {
    this.#transition(BudgetStatus.closed(), now);
    this.#events.push(budgetClosedEvent(context, this.#id));
  }

  /** Produces a persistence snapshot of the budget (PERSISTENCE.md §4). */
  static snapshot(budget: Budget): BudgetSnapshot {
    return {
      id: budget.id,
      organizationId: budget.organizationId,
      workspaceId: budget.workspaceId,
      createdBy: budget.createdBy,
      name: budget.name.value,
      allocatedMinorUnits: budget.allocated.minorUnits,
      currency: budget.allocated.currency,
      periodStart: budget.period.periodStart,
      periodEnd: budget.period.periodEnd,
      status: budget.status.value,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
      version: budget.version,
    };
  }

  /**
   * Reconstructs a {@link Budget} from a persistence snapshot without
   * emitting domain events (DDD reconstitution factory).
   */
  static hydrate(snapshot: BudgetSnapshot): Budget {
    const budget = new Budget(
      {
        organizationId: snapshot.organizationId,
        workspaceId: snapshot.workspaceId,
        createdBy: snapshot.createdBy,
        name: snapshot.name,
        allocatedMinorUnits: snapshot.allocatedMinorUnits,
        currency: snapshot.currency,
        periodStart: snapshot.periodStart,
        periodEnd: snapshot.periodEnd,
      },
      snapshot.createdAt,
    );
    budget.#id = snapshot.id;
    budget.#status = BudgetStatus.from(snapshot.status);
    budget.#updatedAt = snapshot.updatedAt;
    budget.#version = snapshot.version;
    return budget;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Applies a validated lifecycle transition (policy check → mutate). */
  #transition(target: BudgetStatus, now: string): void {
    const allowed = BUDGET_TRANSITIONS[this.#status.value];
    if (!allowed.includes(target.value)) {
      throw new FinanceStateTransitionError(
        `Cannot transition a budget from ${this.#status.value} to ${target.value}`,
        { budgetId: this.#id, from: this.#status.value, to: target.value },
      );
    }
    this.#status = target;
    this.#bump(now);
  }

  /** Throws when the budget is in a terminal state (cannot be mutated). */
  #assertMutable(action: string): void {
    if (this.#status.isTerminal()) {
      throw new FinanceStateTransitionError(
        `Cannot ${action} a budget in status ${this.#status.value}`,
        {
          budgetId: this.#id,
          from: this.#status.value,
        },
      );
    }
  }

  /** Bumps the version and updated-at timestamp (optimistic concurrency). */
  #bump(now = nowIso()): void {
    this.#version += 1;
    this.#updatedAt = now;
  }
}
