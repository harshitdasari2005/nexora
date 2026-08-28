/**
 * @nexora/module-finance — Money value object.
 *
 * An amount of money, stored as an integer count of MINOR UNITS (e.g. paise,
 * cents) plus an ISO-4217-shaped currency code — never a floating-point
 * amount, so arithmetic and comparisons never drift (DOMAIN_MODEL.md §5
 * MoneyService: "Money arithmetic and validation, no floating-point drift").
 * This vertical slice does not implement multi-currency conversion — every
 * amount is compared only against amounts already known to share a
 * currency (the same budget/tenant); cross-currency arithmetic is out of
 * scope (not "unnecessary enterprise accounting software").
 */

import { InvalidFinanceValueError } from '../errors/index.js';

/** Currency code pattern: three uppercase letters (ISO-4217 shape). */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** The maximum minor-units amount accepted (bounds pathological input). */
const MAX_MINOR_UNITS = 1_000_000_000_00;

/** A validated money amount (integer minor units + currency). Immutable. */
export class Money {
  readonly #minorUnits: number;
  readonly #currency: string;

  private constructor(minorUnits: number, currency: string) {
    this.#minorUnits = minorUnits;
    this.#currency = currency;
  }

  /**
   * Creates a {@link Money} amount.
   *
   * @param minorUnits - a non-negative integer count of minor units (e.g. paise).
   * @param currency   - a three-letter uppercase currency code (e.g. `INR`).
   * @throws {InvalidFinanceValueError} when either value is invalid.
   */
  static create(minorUnits: number, currency: string): Money {
    const issues: { path: string; message: string }[] = [];
    if (!Number.isInteger(minorUnits) || minorUnits < 0) {
      issues.push({ path: 'minorUnits', message: 'Must be a non-negative integer' });
    } else if (minorUnits > MAX_MINOR_UNITS) {
      issues.push({ path: 'minorUnits', message: `Must be at most ${MAX_MINOR_UNITS}` });
    }
    if (!CURRENCY_PATTERN.test(currency)) {
      issues.push({ path: 'currency', message: 'Must be a three-letter uppercase currency code' });
    }
    if (issues.length > 0) {
      throw new InvalidFinanceValueError('Invalid money amount', issues);
    }
    return new Money(minorUnits, currency);
  }

  /** The integer count of minor units. */
  get minorUnits(): number {
    return this.#minorUnits;
  }

  /** The three-letter currency code. */
  get currency(): string {
    return this.#currency;
  }

  /** Whether this amount is at least `other` (same currency only). */
  isAtLeast(other: Money): boolean {
    return this.#currency === other.#currency && this.#minorUnits >= other.#minorUnits;
  }

  /**
   * Returns `this + other` as a new {@link Money}. Both amounts must share a
   * currency (no implicit conversion). The result is re-validated, so it
   * still rejects overflow past {@link MAX_MINOR_UNITS}.
   *
   * @throws {InvalidFinanceValueError} on a currency mismatch or an
   *   out-of-bounds sum.
   */
  add(other: Money): Money {
    this.#assertSameCurrency(other, 'add');
    return Money.create(this.#minorUnits + other.#minorUnits, this.#currency);
  }

  /**
   * Returns `this - other` as a new {@link Money}. Both amounts must share a
   * currency; the result must stay non-negative (money is never negative in
   * this model — a would-be negative result is a business error, not a
   * value).
   *
   * @throws {InvalidFinanceValueError} on a currency mismatch or a negative
   *   result.
   */
  subtract(other: Money): Money {
    this.#assertSameCurrency(other, 'subtract');
    return Money.create(this.#minorUnits - other.#minorUnits, this.#currency);
  }

  /** Guards that `other` shares this amount's currency. */
  #assertSameCurrency(other: Money, op: string): void {
    if (this.#currency !== other.#currency) {
      throw new InvalidFinanceValueError(`Cannot ${op} money of different currencies`, [
        {
          path: 'currency',
          message: `Expected ${this.#currency}, received ${other.#currency}`,
        },
      ]);
    }
  }

  /** Structural equality against another {@link Money}. */
  equals(other: Money): boolean {
    return this.#minorUnits === other.#minorUnits && this.#currency === other.#currency;
  }
}
