/**
 * @nexora/module-finance — BudgetPeriod value object.
 *
 * The period a {@link Budget} covers: an ISO-8601 UTC `periodStart` and a
 * `periodEnd` strictly after the start (a zero-length or backwards period
 * is meaningless). Both values are validated as parseable ISO-8601
 * timestamps (PERSISTENCE.md §6 time value objects) — mirrors Calendar's
 * `EventTimeWindow` invariant shape for the same reason: a period a budget
 * covers is itself a time window.
 */

import { isValidIso } from '@nexora/shared/time';

import { InvalidFinanceValueError } from '../errors/index.js';

/** A validated budget period. Immutable. */
export class BudgetPeriod {
  readonly #periodStart: string;
  readonly #periodEnd: string;

  private constructor(periodStart: string, periodEnd: string) {
    this.#periodStart = periodStart;
    this.#periodEnd = periodEnd;
  }

  /**
   * Creates a {@link BudgetPeriod} from ISO-8601 UTC timestamps.
   *
   * @throws {InvalidFinanceValueError} when either value is not a valid ISO
   *         timestamp or when `periodEnd` is not strictly after `periodStart`.
   */
  static create(periodStart: string, periodEnd: string): BudgetPeriod {
    const issues: { path: string; message: string }[] = [];
    if (!isValidIso(periodStart)) {
      issues.push({ path: 'periodStart', message: 'Must be a valid ISO-8601 timestamp' });
    }
    if (!isValidIso(periodEnd)) {
      issues.push({ path: 'periodEnd', message: 'Must be a valid ISO-8601 timestamp' });
    }
    if (issues.length === 0 && Date.parse(periodEnd) <= Date.parse(periodStart)) {
      issues.push({ path: 'periodEnd', message: 'Must be after periodStart' });
    }
    if (issues.length > 0) {
      throw new InvalidFinanceValueError('Invalid budget period', issues);
    }
    return new BudgetPeriod(periodStart, periodEnd);
  }

  /** ISO-8601 UTC period start instant. */
  get periodStart(): string {
    return this.#periodStart;
  }

  /** ISO-8601 UTC period end instant (strictly after {@link BudgetPeriod.periodStart}). */
  get periodEnd(): string {
    return this.#periodEnd;
  }

  /** Structural equality against another {@link BudgetPeriod}. */
  equals(other: BudgetPeriod): boolean {
    return this.#periodStart === other.#periodStart && this.#periodEnd === other.#periodEnd;
  }
}
