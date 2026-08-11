/**
 * @nexora/domain-identity — Email value object.
 *
 * A validated, normalized email address. Emails are stored lowercase and
 * trimmed (identity is case-insensitive per DDD invariants). Reuses the
 * shared `isEmail` validator for syntactic checks (PSD.md §10 user model).
 */

import { isEmail } from '@nexora/shared/validation';

import { InvalidIdentityValueError } from '../errors/index.js';

/** A validated email address. Immutable. */
export class Email {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates an {@link Email} from a raw string.
   *
   * @param input - the raw email address.
   * @throws {InvalidIdentityValueError} when the value is not a valid email.
   */
  static create(input: string): Email {
    const value = input.trim().toLowerCase();
    const issue = isEmail('email', value);
    if (issue !== null) {
      throw new InvalidIdentityValueError('Invalid email address', [issue]);
    }
    return new Email(value);
  }

  /** The normalized (lowercase, trimmed) email address. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link Email}. */
  equals(other: Email): boolean {
    return this.#value === other.#value;
  }

  /** Returns the normalized value. */
  toString(): string {
    return this.#value;
  }
}
