/**
 * @nexora/domain-identity — UserStatus value object.
 *
 * The lifecycle status of a {@link User}. Transitions are governed by the
 * `UserLifecyclePolicy` (DOMAIN_MODEL.md §14.1 user lifecycle).
 */

import { InvalidIdentityValueError } from '../errors/index.js';

/** User lifecycle statuses (PSD.md §10 user model). */
export const USER_STATUSES = ['pending', 'active', 'suspended', 'deactivated'] as const;

/** Single user status literal. */
export type UserStatusValue = (typeof USER_STATUSES)[number];

/** The lifecycle status of a user. Immutable. */
export class UserStatus {
  readonly #value: UserStatusValue;

  private constructor(value: UserStatusValue) {
    this.#value = value;
  }

  /** The user is awaiting activation (e.g. invited but not yet activated). */
  static pending(): UserStatus {
    return new UserStatus('pending');
  }

  /** The user is active and may authenticate. */
  static active(): UserStatus {
    return new UserStatus('active');
  }

  /** The user is temporarily unable to authenticate. */
  static suspended(): UserStatus {
    return new UserStatus('suspended');
  }

  /** The user was deactivated and can no longer authenticate. */
  static deactivated(): UserStatus {
    return new UserStatus('deactivated');
  }

  /**
   * Creates a {@link UserStatus} from a raw string.
   *
   * @param value - one of {@link USER_STATUSES}.
   * @throws {InvalidIdentityValueError} when the value is unknown.
   */
  static from(value: string): UserStatus {
    const member = USER_STATUSES.find((status) => status === value);
    if (member === undefined) {
      throw new InvalidIdentityValueError('Invalid user status', [
        { path: 'status', message: `Must be one of: ${USER_STATUSES.join(', ')}` },
      ]);
    }
    return new UserStatus(member);
  }

  /** The status value. */
  get value(): UserStatusValue {
    return this.#value;
  }

  /** Whether the user may authenticate (status is `active`). */
  isActive(): boolean {
    return this.#value === 'active';
  }

  /** Structural equality against another {@link UserStatus}. */
  equals(other: UserStatus): boolean {
    return this.#value === other.#value;
  }

  /** Returns the status value. */
  toString(): string {
    return this.#value;
  }
}
