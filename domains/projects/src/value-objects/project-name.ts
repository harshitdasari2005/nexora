/**
 * @nexora/domain-projects — ProjectName value object.
 *
 * The human-readable name of a {@link Project}. Trimmed, non-empty, bounded
 * by the platform name limit (constants `MAX_NAME_LENGTH`).
 */

import { maxLength, required } from '@nexora/shared/validation';
import { MAX_NAME_LENGTH } from '@nexora/shared/constants';

import { InvalidProjectValueError } from '../errors/index.js';

/** A validated project name. Immutable. */
export class ProjectName {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates a {@link ProjectName} from a raw string.
   *
   * @param input - the raw name (trimmed here).
   * @throws {InvalidProjectValueError} when the name is empty or too long.
   */
  static create(input: string): ProjectName {
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
      throw new InvalidProjectValueError('Invalid project name', issues);
    }
    return new ProjectName(value);
  }

  /** The normalized (trimmed) project name. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link ProjectName}. */
  equals(other: ProjectName): boolean {
    return this.#value === other.#value;
  }

  /** Returns the name. */
  toString(): string {
    return this.#value;
  }
}
