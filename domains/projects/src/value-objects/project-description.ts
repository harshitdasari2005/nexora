/**
 * @nexora/domain-projects — ProjectDescription value object.
 *
 * An optional free-text description of a {@link Project}. Trimmed; when
 * non-empty it is bounded by the platform text limit for short descriptions.
 */

import { maxLength } from '@nexora/shared/validation';

import { InvalidProjectValueError } from '../errors/index.js';

/** Maximum project description length (short description budget). */
export const MAX_PROJECT_DESCRIPTION_LENGTH = 2000;

/** A validated optional project description. Immutable. */
export class ProjectDescription {
  readonly #value: string | undefined;

  private constructor(value: string | undefined) {
    this.#value = value;
  }

  /**
   * Creates a {@link ProjectDescription} from a raw string. Empty or
   * whitespace-only input yields `undefined` (no description).
   *
   * @param input - the raw description.
   * @throws {InvalidProjectValueError} when the description is too long.
   */
  static create(input: string | undefined): ProjectDescription {
    if (input === undefined) {
      return new ProjectDescription(undefined);
    }
    const value = input.trim();
    if (value.length === 0) {
      return new ProjectDescription(undefined);
    }
    const lengthIssue = maxLength('description', value, MAX_PROJECT_DESCRIPTION_LENGTH);
    if (lengthIssue !== null) {
      throw new InvalidProjectValueError('Invalid project description', [lengthIssue]);
    }
    return new ProjectDescription(value);
  }

  /** The normalized description, or `undefined` when absent. */
  get value(): string | undefined {
    return this.#value;
  }

  /** Whether a description is present. */
  get isPresent(): boolean {
    return this.#value !== undefined;
  }

  /** Structural equality against another {@link ProjectDescription}. */
  equals(other: ProjectDescription): boolean {
    return this.#value === other.#value;
  }
}
