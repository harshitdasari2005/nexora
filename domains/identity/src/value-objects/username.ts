/**
 * @nexora/domain-identity — Username value object.
 *
 * A validated login handle. Usernames are lowercase, 3–32 characters, and
 * may contain letters, digits, dots, underscores, and hyphens; they must
 * start with a letter or digit (PSD.md §10 user model).
 */

import { minLength, maxLength, required } from '@nexora/shared/validation';

import { InvalidIdentityValueError } from '../errors/index.js';

/** Username shape: lowercase alphanumeric start, then [a-z0-9._-]. */
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** A validated username. Immutable. */
export class Username {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates a {@link Username} from a raw string.
   *
   * @param input - the raw username.
   * @throws {InvalidIdentityValueError} when the value violates username rules.
   */
  static create(input: string): Username {
    const value = input.trim().toLowerCase();
    const issues = [
      required('username', value),
      minLength('username', value, 3),
      maxLength('username', value, 32),
    ].filter((issue) => issue !== null);
    if (issues.length === 0 && !USERNAME_PATTERN.test(value)) {
      issues.push({
        path: 'username',
        message: 'May only contain letters, digits, dots, underscores, and hyphens',
      });
    }
    if (issues.length > 0) {
      throw new InvalidIdentityValueError('Invalid username', issues);
    }
    return new Username(value);
  }

  /** The normalized (lowercase, trimmed) username. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link Username}. */
  equals(other: Username): boolean {
    return this.#value === other.#value;
  }

  /** Returns the normalized value. */
  toString(): string {
    return this.#value;
  }
}
