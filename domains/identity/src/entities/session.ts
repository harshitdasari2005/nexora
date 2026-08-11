/**
 * @nexora/domain-identity — Session aggregate root.
 *
 * A user session (DOMAIN_MODEL.md §2.2). Owns its lifecycle: started via
 * {@link Session.start}, touched on use, ended on logout, expired passively,
 * or revoked on a security event. Invariants: an ended/revoked session can
 * never become active again, and a session cannot be used past its expiry.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, UserId } from '@nexora/contracts/common';

import type { IdentityEventContext } from '../events/index.js';
import { sessionEndedEvent, sessionStartedEvent } from '../events/index.js';
import { SessionExpiredError, SessionRevokedError } from '../errors/index.js';
import { SessionStatus } from '../value-objects/session-status.js';

/** Input for starting a new {@link Session}. */
export interface StartSessionInput {
  /** The session owner. */
  userId: UserId;
  /** The tenant the session belongs to. */
  tenantId: TenantId;
  /** The opaque bearer token value (created by the service). */
  token: string;
  /** ISO-8601 UTC issue time (defaults to now). */
  issuedAt?: string;
  /** ISO-8601 UTC expiry time (from the `SessionPolicy`). */
  expiresAt: string;
}

/**
 * A persistence snapshot of the {@link Session} aggregate (PERSISTENCE.md §4
 * aggregate ownership). Plain data produced by {@link Session.snapshot} and
 * consumed by {@link Session.hydrate} — no behavior.
 */
export interface SessionSnapshot {
  /** The session id. */
  id: string;
  /** The session owner. */
  userId: UserId;
  /** The tenant the session belongs to. */
  tenantId: TenantId;
  /** The opaque bearer token value. */
  token: string;
  /** The lifecycle status value. */
  status: string;
  /** ISO-8601 UTC issue time. */
  issuedAt: string;
  /** ISO-8601 UTC expiry time. */
  expiresAt: string;
  /** ISO-8601 UTC time of last use. */
  lastUsedAt: string;
  /** ISO-8601 UTC end time, when ended/expired/revoked. */
  endedAt?: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link Session} aggregate root. Use {@link Session.start} to
 * construct; mutate only through aggregate methods.
 */
export class Session {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: string;
  readonly #userId: UserId;
  readonly #tenantId: TenantId;
  readonly #token: string;
  #status: SessionStatus;
  readonly #issuedAt: string;
  #expiresAt: string;
  #lastUsedAt: string;
  #endedAt?: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: StartSessionInput, issuedAt: string) {
    this.#id = prefixedId('ses') as string;
    this.#userId = input.userId;
    this.#tenantId = input.tenantId;
    this.#token = input.token;
    this.#status = SessionStatus.active();
    this.#issuedAt = issuedAt;
    this.#expiresAt = input.expiresAt;
    this.#lastUsedAt = issuedAt;
    this.#version = 1;
  }

  /**
   * Starts a new active {@link Session} and records a
   * {@link sessionStartedEvent}.
   *
   * @param input   - session data.
   * @param context - event context.
   */
  static start(input: StartSessionInput, context: IdentityEventContext): Session {
    const issuedAt = input.issuedAt ?? nowIso();
    const session = new Session(input, issuedAt);
    session.#events.push(
      sessionStartedEvent(context, {
        sessionId: session.#id,
        userId: session.#userId,
        issuedAt,
        expiresAt: session.#expiresAt,
      }),
    );
    return session;
  }

  /** The session id. */
  get id(): string {
    return this.#id;
  }

  /** The session owner. */
  get userId(): UserId {
    return this.#userId;
  }

  /** The tenant the session belongs to. */
  get tenantId(): TenantId {
    return this.#tenantId;
  }

  /** The opaque bearer token value. */
  get token(): string {
    return this.#token;
  }

  /** The lifecycle status. */
  get status(): SessionStatus {
    return this.#status;
  }

  /** ISO-8601 UTC issue time. */
  get issuedAt(): string {
    return this.#issuedAt;
  }

  /** ISO-8601 UTC expiry time. */
  get expiresAt(): string {
    return this.#expiresAt;
  }

  /** ISO-8601 UTC time of last use. */
  get lastUsedAt(): string {
    return this.#lastUsedAt;
  }

  /** ISO-8601 UTC time the session ended, when ended. */
  get endedAt(): string | undefined {
    return this.#endedAt;
  }

  /** Monotonic version for optimistic concurrency. */
  get version(): number {
    return this.#version;
  }

  /** Whether the session is usable at the given instant. */
  isActive(now: string): boolean {
    return this.#status.isActive() && now < this.#expiresAt;
  }

  /** Whether the session passed its expiry time. */
  isExpired(now: string): boolean {
    return now >= this.#expiresAt;
  }

  /**
   * Records use of the session (updates `lastUsedAt`).
   *
   * @param now - ISO-8601 UTC current time.
   * @throws {SessionExpiredError} when the session is past expiry.
   * @throws {SessionRevokedError} when the session already ended/revoked.
   */
  touch(now: string): void {
    if (!this.#status.isActive()) {
      throw new SessionRevokedError({ sessionId: this.#id, status: this.#status.value });
    }
    if (this.isExpired(now)) {
      this.#expire(now);
      throw new SessionExpiredError({ sessionId: this.#id });
    }
    this.#lastUsedAt = now;
    this.#bump();
  }

  /**
   * Ends the session (logout) and records a {@link sessionEndedEvent}.
   * Idempotent: ending an already-ended/revoked session is a no-op.
   *
   * @param context - event context.
   * @param reason  - why the session ended (defaults to `logout`).
   * @returns true when the session transitioned to `ended`.
   */
  end(context: IdentityEventContext, reason = 'logout'): boolean {
    if (this.#status.value === 'ended' || this.#status.value === 'revoked') {
      return false;
    }
    this.#status = SessionStatus.ended();
    this.#endedAt = nowIso();
    this.#bump();
    this.#events.push(
      sessionEndedEvent(context, { sessionId: this.#id, userId: this.#userId, reason }),
    );
    return true;
  }

  /**
   * Revokes the session (security event) and records a
   * {@link sessionEndedEvent}. Idempotent.
   *
   * @param context - event context.
   * @param reason  - why the session was revoked.
   * @returns true when the session transitioned to `revoked`.
   */
  revoke(context: IdentityEventContext, reason: string): boolean {
    if (this.#status.value === 'ended' || this.#status.value === 'revoked') {
      return false;
    }
    this.#status = SessionStatus.revoked();
    this.#endedAt = nowIso();
    this.#bump();
    this.#events.push(
      sessionEndedEvent(context, { sessionId: this.#id, userId: this.#userId, reason }),
    );
    return true;
  }

  /**
   * Passively expires the session when it is past expiry. Emits a
   * {@link sessionEndedEvent} with reason `expired` on transition.
   *
   * @param now - ISO-8601 UTC current time.
   * @returns true when the session transitioned to `expired`.
   */
  expire(now: string): boolean {
    if (this.#status.value === 'expired' || !this.#status.isActive()) {
      return false;
    }
    return this.#expire(now);
  }

  /**
   * Produces a persistence snapshot of the session (PERSISTENCE.md §4
   * aggregate ownership).
   */
  static snapshot(session: Session): SessionSnapshot {
    return {
      id: session.id,
      userId: session.userId,
      tenantId: session.tenantId,
      token: session.token,
      status: session.status.value,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
      endedAt: session.endedAt,
      version: session.version,
    };
  }

  /**
   * Reconstructs a {@link Session} from a persistence snapshot without
   * emitting domain events (DDD reconstitution factory).
   */
  static hydrate(snapshot: SessionSnapshot): Session {
    const session = new Session(
      {
        userId: snapshot.userId,
        tenantId: snapshot.tenantId,
        token: snapshot.token,
        issuedAt: snapshot.issuedAt,
        expiresAt: snapshot.expiresAt,
      },
      snapshot.issuedAt,
    );
    session.#id = snapshot.id;
    session.#status = SessionStatus.from(snapshot.status);
    session.#lastUsedAt = snapshot.lastUsedAt;
    session.#endedAt = snapshot.endedAt;
    session.#version = snapshot.version;
    return session;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Transitions an active session to expired and records the event. */
  #expire(now: string): boolean {
    this.#status = SessionStatus.expired();
    this.#endedAt = now;
    this.#bump();
    this.#events.push(
      sessionEndedEvent(this.#tenantContext(), {
        sessionId: this.#id,
        userId: this.#userId,
        reason: 'expired',
      }),
    );
    return true;
  }

  /**
   * A minimal event context used for passive expiry. The actor is the
   * platform itself (`system`), never the session owner: the user did not
   * perform the expiry, so the audit trail must not attribute it to them
   * (PERSISTENCE.md §13 audit storage).
   */
  #tenantContext(): IdentityEventContext {
    return {
      actor: { kind: 'system', id: 'system:identity:session-expiry' },
      correlationId: `session:${this.#id}`,
      tenantId: this.#tenantId,
    };
  }

  /** Bumps the version (optimistic concurrency). */
  #bump(): void {
    this.#version += 1;
  }
}
