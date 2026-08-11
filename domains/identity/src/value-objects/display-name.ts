/**
 * @nexora/domain-identity — DisplayName value object.
 *
 * The human-readable name shown in the UI. Bounded by the platform
 * `MAX_NAME_LENGTH` convention (`@nexora/shared/constants`).
 */

import { isValidName } from '@nexora/shared/validation';

import { InvalidIdentityValueError } from '../errors/index.js';

/** A validated display name. Immutable. */
export class DisplayName {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates a {@link DisplayName} from a raw string.
   *
   * @param input - the raw display name.
   * @throws {InvalidIdentityValueError} when the name is empty or too long.
   */
  static create(input: string): DisplayName {
    const value = input.trim();
    const issue = isValidName('displayName', value);
    if (issue !== null) {
      throw new InvalidIdentityValueError('Invalid display name', [issue]);
    }
    return new DisplayName(value);
  }

  /** The trimmed display name. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link DisplayName}. */
  equals(other: DisplayName): boolean {
    return this.#value === other.#value;
  }

  /** Returns the display name. */
  toString(): string {
    return this.#value;
  }
}
