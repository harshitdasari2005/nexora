/**
 * @nexora/module-finance — BudgetStatus value object.
 *
 * The lifecycle status of a {@link Budget} (DOMAIN_MODEL.md §4.4, BR-10): a
 * budget is `active` until either a deterministic over-threshold detection
 * flags it `under_review` (DETECTION.md-style signal → remediation, never an
 * LLM decision — the flag is a real, reversible state change, not a
 * notify-only no-op) or it is explicitly `closed` (terminal).
 */

import { InvalidFinanceValueError } from '../errors/index.js';

/** Budget lifecycle statuses (DOMAIN_MODEL.md §4.4). */
export const BUDGET_STATUSES = ['active', 'under_review', 'closed'] as const;

/** Single budget status literal. */
export type BudgetStatusValue = (typeof BUDGET_STATUSES)[number];

/** The lifecycle status of a budget. Immutable. */
export class BudgetStatus {
  readonly #value: BudgetStatusValue;

  private constructor(value: BudgetStatusValue) {
    this.#value = value;
  }

  /** The budget is open and its utilization is not currently flagged. */
  static active(): BudgetStatus {
    return new BudgetStatus('active');
  }

  /** The budget's utilization crossed the deterministic threshold. */
  static underReview(): BudgetStatus {
    return new BudgetStatus('under_review');
  }

  /** The budget was closed (terminal). */
  static closed(): BudgetStatus {
    return new BudgetStatus('closed');
  }

  /**
   * Creates a {@link BudgetStatus} from a raw string.
   *
   * @param value - one of {@link BUDGET_STATUSES}.
   * @throws {InvalidFinanceValueError} when the value is unknown.
   */
  static from(value: string): BudgetStatus {
    const member = BUDGET_STATUSES.find((status) => status === value);
    if (member === undefined) {
      throw new InvalidFinanceValueError('Invalid budget status', [
        { path: 'status', message: `Must be one of: ${BUDGET_STATUSES.join(', ')}` },
      ]);
    }
    return new BudgetStatus(member);
  }

  /** The status value. */
  get value(): BudgetStatusValue {
    return this.#value;
  }

  /** Whether the budget is currently active (not flagged, not closed). */
  isActive(): boolean {
    return this.#value === 'active';
  }

  /** Whether the status is terminal (closed). */
  isTerminal(): boolean {
    return this.#value === 'closed';
  }

  /** Structural equality against another {@link BudgetStatus}. */
  equals(other: BudgetStatus): boolean {
    return this.#value === other.#value;
  }

  /** Returns the status value. */
  toString(): string {
    return this.#value;
  }
}
