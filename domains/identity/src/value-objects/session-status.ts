/**
 * @nexora/domain-identity — SessionStatus value object.
 *
 * The lifecycle status of a {@link Session}. Transitions are governed by the
 * `SessionPolicy` and enforced by the Session aggregate (DOMAIN_MODEL.md
 * §14.2 session lifecycle).
 */

import { InvalidIdentityValueError } from '../errors/index.js';

/** Session lifecycle statuses. */
export const SESSION_STATUSES = ['active', 'expired', 'ended', 'revoked'] as const;

/** Single session status literal. */
export type SessionStatusValue = (typeof SESSION_STATUSES)[number];

/** The lifecycle status of a session. Immutable. */
export class SessionStatus {
  readonly #value: SessionStatusValue;

  private constructor(value: SessionStatusValue) {
    this.#value = value;
  }

  /** The session is usable. */
  static active(): SessionStatus {
    return new SessionStatus('active');
  }

  /** The session passed its expiry time. */
  static expired(): SessionStatus {
    return new SessionStatus('expired');
  }

  /** The session was ended by the user (logout). */
  static ended(): SessionStatus {
    return new SessionStatus('ended');
  }

  /** The session was revoked (security event, admin action). */
  static revoked(): SessionStatus {
    return new SessionStatus('revoked');
  }

  /**
   * Creates a {@link SessionStatus} from a raw string.
   *
   * @param value - one of {@link SESSION_STATUSES}.
   * @throws {InvalidIdentityValueError} when the value is unknown.
   */
  static from(value: string): SessionStatus {
    const member = SESSION_STATUSES.find((status) => status === value);
    if (member === undefined) {
      throw new InvalidIdentityValueError('Invalid session status', [
        { path: 'status', message: `Must be one of: ${SESSION_STATUSES.join(', ')}` },
      ]);
    }
    return new SessionStatus(member);
  }

  /** The status value. */
  get value(): SessionStatusValue {
    return this.#value;
  }

  /** Whether the session can still be used (status is `active`). */
  isActive(): boolean {
    return this.#value === 'active';
  }

  /** Structural equality against another {@link SessionStatus}. */
  equals(other: SessionStatus): boolean {
    return this.#value === other.#value;
  }

  /** Returns the status value. */
  toString(): string {
    return this.#value;
  }
}
