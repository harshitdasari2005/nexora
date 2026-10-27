/**
 * @nexora/domain-identity — SessionDomainService.
 *
 * Orchestrates the {@link Session} aggregate lifecycle (DOMAIN_MODEL.md §7):
 * starting a session (authentication), validating a presented token, ending
 * a session, and revoking sessions. Authentication failures are surfaced as
 * a single `InvalidCredentialsError` to avoid user enumeration.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';
import { uuid } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, UserId } from '@nexora/contracts/common';

import type { IdentityEventContext } from '../events/index.js';
import type { User } from '../entities/user.js';
import { Session } from '../entities/session.js';
import type {
  SessionLimitExceededError,
  SessionRevokedError,
  UserNotActiveError,
} from '../errors/index.js';
import {
  InvalidCredentialsError,
  SessionExpiredError,
  SessionNotFoundError,
  SessionTenantMismatchError,
  toIdentityError,
  UserNotFoundError,
} from '../errors/index.js';
import type { SessionRepository, UserRepository, PasswordHasher } from '../repositories/index.js';
import { SessionPolicy, UserLifecyclePolicy } from '../policies/index.js';
import { Email } from '../value-objects/email.js';
import { Username } from '../value-objects/username.js';
import { hashSessionToken } from '../value-objects/session-token.js';

/** Input for starting a session via credentials. */
export interface StartSessionCredentials {
  /** The tenant (company) the session belongs to. */
  tenantId: TenantId;
  /** The email or username of the user. */
  identifier: string;
  /** The raw password. */
  password: string;
}

/** Input for starting a session for an already-verified principal (OIDC). */
export interface StartVerifiedSessionInput {
  /** The verified user. */
  userId: UserId;
  /** The tenant the session belongs to. */
  tenantId: TenantId;
}

/** The outcome of a session command: the aggregate plus emitted events. */
export interface SessionCommandResult {
  /** The mutated aggregate. */
  session: Session;
  /** Domain events emitted by the operation. */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link SessionDomainService}. */
export interface SessionDomainServiceDependencies {
  /** Session persistence. */
  sessions: SessionRepository;
  /** User persistence (authentication). */
  users: UserRepository;
  /** Password hashing port (verification). */
  hasher: PasswordHasher;
  /** Session policy (TTL, idle, concurrency). */
  policy?: SessionPolicy;
  /** User lifecycle policy (session-start eligibility). */
  userPolicy?: UserLifecyclePolicy;
}

/**
 * The session lifecycle use-case service. All methods return a `Result`.
 */
export class SessionDomainService {
  readonly #sessions: SessionRepository;
  readonly #users: UserRepository;
  readonly #hasher: PasswordHasher;
  readonly #policy: SessionPolicy;
  readonly #userPolicy: UserLifecyclePolicy;

  constructor(dependencies: SessionDomainServiceDependencies) {
    this.#sessions = dependencies.sessions;
    this.#users = dependencies.users;
    this.#hasher = dependencies.hasher;
    this.#policy = dependencies.policy ?? new SessionPolicy();
    this.#userPolicy = dependencies.userPolicy ?? new UserLifecyclePolicy();
  }

  /**
   * Starts a new session for a user: resolves the identifier, verifies the
   * password, checks the user may authenticate and the session limit, then
   * creates and persists the session.
   */
  async start(
    input: StartSessionCredentials,
    context: IdentityEventContext,
  ): Promise<
    Result<
      SessionCommandResult,
      InvalidCredentialsError | SessionTenantMismatchError | SessionLimitExceededError
    >
  > {
    try {
      const user = await this.#resolveUser(input.identifier);
      if (user === undefined) {
        return err(new InvalidCredentialsError({ identifier: input.identifier }));
      }

      const verified = await this.#hasher.verify(input.password, user.passwordHash);
      if (!verified) {
        return err(new InvalidCredentialsError({ identifier: input.identifier }));
      }

      // No user enumeration: an inactive user also surfaces as invalid
      // credentials at the login boundary (admin flows re-check status
      // separately).
      if (!this.#userPolicy.assertCanStartSession(user.status)) {
        return err(new InvalidCredentialsError({ identifier: input.identifier }));
      }

      // Defense-in-depth: the session tenant must match the principal's home
      // tenant (see {@link startVerified}).
      if (user.tenantId !== input.tenantId) {
        return err(
          new SessionTenantMismatchError({
            userId: user.id,
            requestedTenantId: input.tenantId,
          }),
        );
      }

      const issuedAt = nowIso();
      // Only LIVE sessions count: one that already passed its absolute or idle
      // lifetime (but was never presented again, so its status is still
      // `active`) does not hold a slot.
      const activeCount = await this.#sessions.countActiveByUser(
        user.id,
        this.#policy.livenessWindow(issuedAt),
      );
      this.#policy.assertCanOpenSession(activeCount);

      const session = Session.start(
        {
          userId: user.id,
          tenantId: input.tenantId,
          token: uuid(),
          issuedAt,
          expiresAt: this.#policy.expiresAt(issuedAt),
        },
        context,
      );
      await this.#sessions.save(session);
      return ok({ session, events: session.pullDomainEvents() });
    } catch (error) {
      return err(
        toIdentityError(error) as
          InvalidCredentialsError | SessionTenantMismatchError | SessionLimitExceededError,
      );
    }
  }

  /**
   * Starts a new session for a principal whose identity was verified by an
   * external identity provider (Keycloak OIDC). No password is checked here:
   * the IdP already authenticated the user. This service validates
   * session-start eligibility (active user, session limit) and issues the
   * session (PSD.md §10 sessions; SAD.md §13.1).
   */ async startVerified(
    input: StartVerifiedSessionInput,
    context: IdentityEventContext,
  ): Promise<
    Result<
      SessionCommandResult,
      | UserNotFoundError
      | UserNotActiveError
      | SessionTenantMismatchError
      | SessionLimitExceededError
    >
  > {
    try {
      const user = await this.#users.findById(input.userId);
      if (user === undefined) {
        return err(new UserNotFoundError({ userId: input.userId }));
      }
      // Defense-in-depth: the session tenant must match the principal's home
      // tenant. The application layer passes the user's own tenant today, so
      // this is a guard against future callers mis-scoping a session.
      if (user.tenantId !== input.tenantId) {
        return err(
          new SessionTenantMismatchError({
            userId: user.id,
            requestedTenantId: input.tenantId,
          }),
        );
      }
      this.#userPolicy.assertUserCanStartSession(user.status);

      const issuedAt = nowIso();
      // Only LIVE sessions count: one that already passed its absolute or idle
      // lifetime (but was never presented again, so its status is still
      // `active`) does not hold a slot.
      const activeCount = await this.#sessions.countActiveByUser(
        user.id,
        this.#policy.livenessWindow(issuedAt),
      );
      this.#policy.assertCanOpenSession(activeCount);

      const session = Session.start(
        {
          userId: user.id,
          tenantId: input.tenantId,
          token: uuid(),
          issuedAt,
          expiresAt: this.#policy.expiresAt(issuedAt),
        },
        context,
      );
      await this.#sessions.save(session);
      return ok({ session, events: session.pullDomainEvents() });
    } catch (error) {
      return err(
        toIdentityError(error) as
          | UserNotFoundError
          | UserNotActiveError
          | SessionTenantMismatchError
          | SessionLimitExceededError,
      );
    }
  }

  /**
   * Validates a presented session token: resolves the session, rejects
   * expired, idle-expired, ended, and revoked sessions, and records the
   * touch.
   */
  async validate(
    token: string,
  ): Promise<Result<Session, SessionNotFoundError | SessionExpiredError | SessionRevokedError>> {
    try {
      // The raw cookie token is hashed here; only the digest is looked up (AUTH-004).
      const session = await this.#sessions.findByTokenHash(hashSessionToken(token));
      if (session === undefined) {
        // Never echo the presented token (it may be a live credential) into error details.
        return err(new SessionNotFoundError({}));
      }
      const now = nowIso();
      if (session.isExpired(now)) {
        session.expire(now);
        await this.#sessions.save(session);
        return err(new SessionExpiredError({ sessionId: session.id }));
      }
      if (this.#policy.isIdleExpired(session.lastUsedAt, now)) {
        session.expire(now);
        await this.#sessions.save(session);
        return err(new SessionExpiredError({ sessionId: session.id, reason: 'idle-timeout' }));
      }
      session.touch(now);
      await this.#sessions.save(session);
      return ok(session);
    } catch (error) {
      return err(
        toIdentityError(error) as SessionNotFoundError | SessionExpiredError | SessionRevokedError,
      );
    }
  }

  /**
   * Whether a session is STILL usable right now — read-only. It applies exactly
   * the rules {@link validate} applies (active status, absolute expiry, idle
   * timeout) but, unlike `validate`, never touches or rewrites the session:
   * a long-lived connection (an SSE stream) re-checking its session must not
   * keep that session alive past its idle timeout, nor change its stored state.
   * An unknown session id is not live.
   */
  async isLive(sessionId: string): Promise<boolean> {
    const session = await this.#sessions.findById(sessionId);
    if (session === undefined) {
      return false;
    }
    const now = nowIso();
    return session.isActive(now) && !this.#policy.isIdleExpired(session.lastUsedAt, now);
  }

  /**
   * Ends a session (logout).
   */
  async end(
    sessionId: string,
    context: IdentityEventContext,
  ): Promise<Result<SessionCommandResult, SessionNotFoundError>> {
    try {
      const session = await this.#requireSession(sessionId);
      session.end(context);
      await this.#sessions.save(session);
      return ok({ session, events: session.pullDomainEvents() });
    } catch (error) {
      return err(toIdentityError(error) as SessionNotFoundError);
    }
  }

  /**
   * Revokes a session (security event).
   */
  async revoke(
    sessionId: string,
    reason: string,
    context: IdentityEventContext,
  ): Promise<Result<SessionCommandResult, SessionNotFoundError>> {
    try {
      const session = await this.#requireSession(sessionId);
      session.revoke(context, reason);
      await this.#sessions.save(session);
      return ok({ session, events: session.pullDomainEvents() });
    } catch (error) {
      return err(toIdentityError(error) as SessionNotFoundError);
    }
  }

  /** Ends every active session of a user (used on deactivation). */
  async endAllForUser(
    userId: UserId,
    context: IdentityEventContext,
  ): Promise<Result<{ sessions: readonly Session[]; events: readonly EventEnvelope[] }, never>> {
    const active = await this.#sessions.findActiveByUser(userId);
    const events: EventEnvelope[] = [];
    for (const session of active) {
      session.end(context, 'user-deactivated');
      await this.#sessions.save(session);
      events.push(...session.pullDomainEvents());
    }
    return ok({ sessions: active, events });
  }

  /** Resolves a user by email or username, or `undefined`. */
  async #resolveUser(identifier: string): Promise<User | undefined> {
    if (identifier.includes('@')) {
      const email = Email.create(identifier);
      return this.#users.findByEmail(email);
    }
    const username = Username.create(identifier);
    return this.#users.findByUsername(username);
  }

  /** Loads a session or throws {@link SessionNotFoundError}. */
  async #requireSession(sessionId: string): Promise<Session> {
    const session = await this.#sessions.findById(sessionId);
    if (session === undefined) {
      throw new SessionNotFoundError({ sessionId });
    }
    return session;
  }
}
