/**
 * @nexora/module-finance — ExpenseDescription value object.
 *
 * The human-readable description of an {@link Expense} (e.g. "Team offsite
 * travel — Bengaluru"). Trimmed, non-empty, bounded by the platform name
 * limit (constants `MAX_NAME_LENGTH`).
 */

import { maxLength, required } from '@nexora/shared/validation';
import { MAX_NAME_LENGTH } from '@nexora/shared/constants';

import { InvalidFinanceValueError } from '../errors/index.js';

/** A validated expense description. Immutable. */
export class ExpenseDescription {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates an {@link ExpenseDescription} from a raw string.
   *
   * @param input - the raw description (trimmed here).
   * @throws {InvalidFinanceValueError} when the description is empty or too long.
   */
  static create(input: string): ExpenseDescription {
    const value = input.trim();
    const issues: { path: string; message: string }[] = [];
    const requiredIssue = required('description', value);
    if (requiredIssue !== null) {
      issues.push(requiredIssue);
    }
    const lengthIssue = maxLength('description', value, MAX_NAME_LENGTH);
    if (lengthIssue !== null) {
      issues.push(lengthIssue);
    }
    if (issues.length > 0) {
      throw new InvalidFinanceValueError('Invalid expense description', issues);
    }
    return new ExpenseDescription(value);
  }

  /** The normalized (trimmed) expense description. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link ExpenseDescription}. */
  equals(other: ExpenseDescription): boolean {
    return this.#value === other.#value;
  }

  /** Returns the description. */
  toString(): string {
    return this.#value;
  }
}
