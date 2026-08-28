/**
 * @nexora/module-finance — ExpenseStatus value object.
 *
 * The lifecycle status of an {@link Expense} (DOMAIN_MODEL.md §4.4, BR-19: a
 * money movement is Consequential and always requires human approval). An
 * expense starts `pending` and reaches exactly one terminal state:
 * `approved` or `rejected`. Only `approved` expenses count as committed
 * spend against their budget — a pending expense has not moved money yet.
 */

import { InvalidFinanceValueError } from '../errors/index.js';

/** Expense lifecycle statuses (DOMAIN_MODEL.md §4.4). */
export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected'] as const;

/** Single expense status literal. */
export type ExpenseStatusValue = (typeof EXPENSE_STATUSES)[number];

/** The lifecycle status of an expense. Immutable. */
export class ExpenseStatus {
  readonly #value: ExpenseStatusValue;

  private constructor(value: ExpenseStatusValue) {
    this.#value = value;
  }

  /** The expense is awaiting a decision. */
  static pending(): ExpenseStatus {
    return new ExpenseStatus('pending');
  }

  /** The expense was approved (terminal — counts as committed spend). */
  static approved(): ExpenseStatus {
    return new ExpenseStatus('approved');
  }

  /** The expense was rejected (terminal). */
  static rejected(): ExpenseStatus {
    return new ExpenseStatus('rejected');
  }

  /**
   * Creates an {@link ExpenseStatus} from a raw string.
   *
   * @param value - one of {@link EXPENSE_STATUSES}.
   * @throws {InvalidFinanceValueError} when the value is unknown.
   */
  static from(value: string): ExpenseStatus {
    const member = EXPENSE_STATUSES.find((status) => status === value);
    if (member === undefined) {
      throw new InvalidFinanceValueError('Invalid expense status', [
        { path: 'status', message: `Must be one of: ${EXPENSE_STATUSES.join(', ')}` },
      ]);
    }
    return new ExpenseStatus(member);
  }

  /** The status value. */
  get value(): ExpenseStatusValue {
    return this.#value;
  }

  /** Whether the expense is still awaiting a decision. */
  isPending(): boolean {
    return this.#value === 'pending';
  }

  /** Whether the status is terminal (approved or rejected). */
  isTerminal(): boolean {
    return this.#value !== 'pending';
  }

  /** Structural equality against another {@link ExpenseStatus}. */
  equals(other: ExpenseStatus): boolean {
    return this.#value === other.#value;
  }

  /** Returns the status value. */
  toString(): string {
    return this.#value;
  }
}
