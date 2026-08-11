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
import { Email, UserAlreadyExistsError } from '@nexora/domain-identity';
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
   * Authenticates a principal verified by an OIDC IdP: provisions the local
   * user on first login (idempotent by email), then issues a session for the
   * verified principal. Emitted events are published.
   */
  async authenticateWithOidc(
    command: AuthenticateWithOidcCommand,
  ): Promise<Result<AuthenticateResult, NexoraError>> {
    try {
      validateAuthenticateWithOidc(command);
      const email = Email.create(command.email);

      let user = await this.#users.findByEmail(email);
      let isNewUser = false;

      if (user === undefined) {
        const provisioned = await this.#provisionExternalUser(command, email);
        if (!provisioned.ok) {
          return err(provisioned.error);
        }
        user = provisioned.value.user;
        isNewUser = true;
        await this.#publisher.publish(provisioned.value.events);
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

  /**
   * Provisions a user from OIDC claims on first login. The account is
   * created active (the IdP verified the identity) under the platform
   * bootstrap tenant with a generated, unusable password — the IdP owns
   * authentication for external identities.
   */
  async #provisionExternalUser(
    command: AuthenticateWithOidcCommand,
    email: Email,
  ): Promise<Result<{ user: User; events: readonly EventEnvelope[] }, NexoraError>> {
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
      },
      this.#context(command.oidcSubject, command.correlationId, PLATFORM_TENANT_ID),
    );
    if (registered.ok) {
      return ok({ user: registered.value.user, events: registered.value.events });
    }
    if (registered.error instanceof UserAlreadyExistsError) {
      // Lost a concurrent provisioning race — fall through to the lookup.
      const existing = await this.#users.findByEmail(email);
      if (existing !== undefined) {
        return ok({ user: existing, events: [] });
      }
    }
    return err(registered.error);
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
