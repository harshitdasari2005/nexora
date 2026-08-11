/**
 * @nexora/domain-hr — EmployeeName value object.
 *
 * The human-readable name of an {@link Employee}. Trimmed, non-empty,
 * bounded by the platform name limit (constants `MAX_NAME_LENGTH`).
 */

import { maxLength, required } from '@nexora/shared/validation';
import { MAX_NAME_LENGTH } from '@nexora/shared/constants';

import { InvalidEmployeeValueError } from '../errors/index.js';

/** A validated employee name. Immutable. */
export class EmployeeName {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates an {@link EmployeeName} from a raw string.
   *
   * @param input - the raw name (trimmed here).
   * @throws {InvalidEmployeeValueError} when the name is empty or too long.
   */
  static create(input: string): EmployeeName {
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
      throw new InvalidEmployeeValueError('Invalid employee name', issues);
    }
    return new EmployeeName(value);
  }

  /** The normalized (trimmed) employee name. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link EmployeeName}. */
  equals(other: EmployeeName): boolean {
    return this.#value === other.#value;
  }

  /** Returns the name. */
  toString(): string {
    return this.#value;
  }
}
