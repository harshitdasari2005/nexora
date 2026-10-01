/**
 * @nexora/application-identity — IdentityApplicationService.
 *
 * The application layer orchestrator (BACKEND.md §4): it coordinates the
 * identity domain services, collects emitted domain events, and publishes
 * them through the {@link EventPublisher} port. It contains no business
 * rules of its own — every invariant is enforced by the domain.
 */

import { randomBytes } from 'node:crypto';

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { EventPublisher, EventEnvelope } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import type {
  IdentityEventContext,
  SessionCommandResult,
  SessionDomainService,
  UserDomainService,
} from '@nexora/domain-identity';
import { Email, InvalidCredentialsError, UserAlreadyExistsError } from '@nexora/domain-identity';
import type { User, UserNotFoundError, UserRepository } from '@nexora/domain-identity';

import type {
  AuthenticateResult,
  AuthenticateWithOidcCommand,
} from '../commands/authenticate-with-oidc.command.js';
import type { EndSessionCommand } from '../commands/end-session.command.js';
import { toUserDto, type UserDto } from '../dto/user.dto.js';
import { validateAuthenticateWithOidc } from '../validators/authenticate-with-oidc.validator.js';

/**
 * The bootstrap tenant for users provisioned before they join an
 * organization. The user's organization link is carried by memberships; the
 * tenant id here is the home tenant of the account record (v1 onboarding).
 */
export const PLATFORM_TENANT_ID = 'tnt_platform' as TenantId;

/** A marker prefix for OIDC-provisioned accounts (auth owned by the IdP). */
const OIDC_PASSWORD_PREFIX = 'oidc-';

/** Dependencies of the {@link IdentityApplicationService}. */
export interface IdentityApplicationServiceDependencies {
  /** User persistence (email lookup for idempotent authentication). */
  users: UserRepository;
  /** The user lifecycle domain service. */
  usersService: UserDomainService;
  /** The session lifecycle domain service. */
  sessionsService: SessionDomainService;
  /** Publishes domain events to the platform event stream. */
  publisher: EventPublisher;
}

/**
 * The identity application service. All methods return a `Result` so
 * expected failures are explicit values.
 */
export class IdentityApplicationService {
  readonly #users: UserRepository;
  readonly #usersService: UserDomainService;
  readonly #sessionsService: SessionDomainService;
  readonly #publisher: EventPublisher;

  constructor(dependencies: IdentityApplicationServiceDependencies) {
    this.#users = dependencies.users;
    this.#usersService = dependencies.usersService;
    this.#sessionsService = dependencies.sessionsService;
    this.#publisher = dependencies.publisher;
  }

  /**
   * Authenticates a principal verified by an OIDC IdP and issues a session.
   *
   * The account is identified by the stable external identity — the pair
   * (issuer, subject) — NOT by email (AUTH-009). Order:
   *
   * 1. validate (issuer, subject, email, `email_verified === true`) BEFORE any lookup;
   * 2. an account already bound to (issuer, subject) is the account — even if
   *    its email differs from the IdP's current claim;
   * 3. otherwise the normalized email is consulted ONLY to:
   *    - provision a new account, bound to (issuer, subject) in the same insert;
   *    - bind (issuer, subject) to an existing UNBOUND account (a legacy account
   *      from before binding existed) — atomically, first identity wins;
   *    and an account already bound to a DIFFERENT identity is never reused: the
   *    login fails with the generic invalid-credentials error, which reveals
   *    neither that the account exists nor what it is bound to.
   *
   * Emitted events are published. (Scope: OIDC login only; the signed inbound
   * email approval path keeps its own sender-email mapping.)
   */
  async authenticateWithOidc(
    command: AuthenticateWithOidcCommand,
  ): Promise<Result<AuthenticateResult, NexoraError>> {
    try {
      validateAuthenticateWithOidc(command);
      const email = Email.create(command.email);
      const issuer = command.issuer.trim();
      const subject = command.oidcSubject.trim();

      let user = await this.#users.findByOidcIdentity(issuer, subject);
      let isNewUser = false;

      if (user === undefined) {
        const byEmail = await this.#users.findByEmail(email);
        if (byEmail === undefined) {
          const provisioned = await this.#provisionExternalUser(command, email, issuer, subject);
          if (provisioned.ok) {
            user = provisioned.value.user;
            isNewUser = provisioned.value.created;
            await this.#publisher.publish(provisioned.value.events);
          } else if (provisioned.error instanceof UserAlreadyExistsError) {
            // Lost a concurrent first-login race: resolve against what now exists.
            user = await this.#resolveExisting(email, issuer, subject);
          } else {
            return err(provisioned.error);
          }
        } else {
          user = await this.#resolveExisting(email, issuer, subject, byEmail);
        }
      }
      if (user === undefined) {
        // Bound to another identity (or lost the binding race to one): generic failure.
        return err(new InvalidCredentialsError());
      }

      const context = this.#context(user.id, command.correlationId, user.tenantId);
      const sessionResult = await this.#sessionsService.startVerified(
        { userId: user.id, tenantId: user.tenantId },
        context,
      );
      if (!sessionResult.ok) {
        return err(sessionResult.error);
      }
      await this.#publisher.publish(sessionResult.value.events);

      return ok({
        userId: user.id,
        sessionToken: sessionResult.value.session.token,
        isNewUser,
      });
    } catch (error) {
      return err(toNexoraError(error));
    }
  }

  /**
   * Resolves the account for an identity that has no bound account yet, when an
   * account with the same normalized email exists. Binds an unbound account;
   * refuses a bound one. `undefined` = refuse.
   */
  async #resolveExisting(
    email: Email,
    issuer: string,
    subject: string,
    known?: User,
  ): Promise<User | undefined> {
    // The identity may have been bound by a concurrent login since the first lookup.
    const owner = await this.#users.findByOidcIdentity(issuer, subject);
    if (owner !== undefined) {
      return owner;
    }
    const existing = known ?? (await this.#users.findByEmail(email));
    if (existing === undefined) {
      return undefined;
    }
    if (existing.oidcIssuer !== undefined) {
      // Bound to a DIFFERENT identity (an equal one would have been found above).
      return undefined;
    }
    if (await this.#users.bindOidcIdentity(existing.id, issuer, subject)) {
      return (await this.#users.findById(existing.id)) ?? undefined;
    }
    // Lost the binding race. If the winner was this very identity (two
    // concurrent logins of the same person), that account is ours; otherwise refuse.
    return this.#users.findByOidcIdentity(issuer, subject);
  }

  /**
   * Provisions a user from OIDC claims on first login. The account is created
   * active (the IdP verified the identity) under the platform bootstrap tenant
   * with a generated, unusable password — and BOUND to (issuer, subject) in the
   * same insert (never created unbound and bound later). The IdP owns
   * authentication for external identities.
   */
  async #provisionExternalUser(
    command: AuthenticateWithOidcCommand,
    email: Email,
    issuer: string,
    subject: string,
  ): Promise<
    Result<{ user: User; events: readonly EventEnvelope[]; created: boolean }, NexoraError>
  > {
    const username = deriveUsername(command.email);
    // Guaranteed to satisfy the password policy (hex: letters + digits).
    const generatedPassword = `${OIDC_PASSWORD_PREFIX}${randomBytes(16).toString('hex')}`;
    const displayName = command.displayName?.trim() || (command.email.split('@')[0] ?? 'User');

    const registered = await this.#usersService.register(
      {
        tenantId: PLATFORM_TENANT_ID,
        email: command.email,
        username,
        password: generatedPassword,
        displayName,
        status: 'active',
        oidcIssuer: issuer,
        oidcSubject: subject,
      },
      this.#context(command.oidcSubject, command.correlationId, PLATFORM_TENANT_ID),
    );
    if (registered.ok) {
      return ok({
        user: registered.value.user,
        events: registered.value.events,
        created: true,
      });
    }
    return err(registered.error);
  }

  /**
   * Ends a session (logout) and publishes the emitted events.
   */
  async endSession(command: EndSessionCommand): Promise<Result<SessionCommandResult, NexoraError>> {
    try {
      const context = this.#context(command.actorId, command.correlationId, command.tenantId);
      const ended = await this.#sessionsService.end(command.sessionId, context);
      if (!ended.ok) {
        return err(ended.error);
      }
      await this.#publisher.publish(ended.value.events);
      return ok(ended.value);
    } catch (error) {
      return err(toNexoraError(error));
    }
  }

  /**
   * Returns the public DTO of a user, or a {@link UserNotFoundError}.
   */
  async getCurrentUser(userId: UserId): Promise<Result<UserDto, UserNotFoundError>> {
    const found = await this.#usersService.findById(userId);
    if (!found.ok) {
      return err(found.error);
    }
    return ok(toUserDto(found.value));
  }

  /** Builds an identity event context for the given actor. */
  #context(actorId: string, correlationId: string, tenantId: TenantId): IdentityEventContext {
    return { actor: { kind: 'user', id: actorId }, correlationId, tenantId };
  }
}

/**
 * Derives a platform username from an email address. Prefers the local part
 * when it satisfies the username rules; otherwise falls back to a stable
 * `user_<hex>` handle that always passes the domain pattern.
 */
export function deriveUsername(email: string): string {
  const local = (email.split('@')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[^a-z0-9]+/, '');
  if (local.length >= 3 && local.length <= 32) {
    return local;
  }
  return `user_${randomBytes(4).toString('hex')}`;
}

/** Normalizes unexpected failures to a stable error type (shared helper). */
export { toNexoraError };
