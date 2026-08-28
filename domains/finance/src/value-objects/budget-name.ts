/**
 * @nexora/module-finance — BudgetName value object.
 *
 * The human-readable name of a {@link Budget} (e.g. "Engineering — Q3
 * FY26"). Trimmed, non-empty, bounded by the platform name limit
 * (constants `MAX_NAME_LENGTH`).
 */

import { maxLength, required } from '@nexora/shared/validation';
import { MAX_NAME_LENGTH } from '@nexora/shared/constants';

import { InvalidFinanceValueError } from '../errors/index.js';

/** A validated budget name. Immutable. */
export class BudgetName {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates a {@link BudgetName} from a raw string.
   *
   * @param input - the raw name (trimmed here).
   * @throws {InvalidFinanceValueError} when the name is empty or too long.
   */
  static create(input: string): BudgetName {
    const value = input.trim();
    const issues: { path: string; message: string }[] = [];
    const requiredIssue = required('name', value);
    if (requiredIssue !== null) {
      issues.push(requiredIssue);
    }
    const lengthIssue = maxLength('name', value, MAX_NAME_LENGTH);
    if (lengthIssue !== null) {
      issues.push(lengthIssue);
    }
    if (issues.length > 0) {
      throw new InvalidFinanceValueError('Invalid budget name', issues);
    }
    return new BudgetName(value);
  }

  /** The normalized (trimmed) budget name. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link BudgetName}. */
  equals(other: BudgetName): boolean {
    return this.#value === other.#value;
  }

  /** Returns the name. */
  toString(): string {
    return this.#value;
  }
}
