/**
 * @nexora/domain-identity — UserDomainService.
 *
 * Orchestrates the {@link User} aggregate lifecycle (DOMAIN_MODEL.md §7):
 * registration, activation, deactivation, role assignment, profile updates,
 * and password changes. Owns the use-case workflows that span the aggregate
 * and its repositories; the aggregate enforces its own invariants.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';
import type { TenantId, UserId } from '@nexora/contracts/common';

import type { IdentityEventContext } from '../events/index.js';
import { User } from '../entities/user.js';
import type { UserProfileUpdate } from '../entities/user-profile.js';
import type { UserStateTransitionError } from '../errors/index.js';
import {
  InvalidCredentialsError,
  InvalidIdentityValueError,
  RoleNotFoundError,
  toIdentityError,
  UserAlreadyExistsError,
  UserNotFoundError,
} from '../errors/index.js';
import type {
  UserRepository,
  SessionRepository,
  RoleRepository,
  PasswordHasher,
} from '../repositories/index.js';
import { UserLifecyclePolicy } from '../policies/index.js';
import { DisplayName } from '../value-objects/display-name.js';
import { Email } from '../value-objects/email.js';
import { Username } from '../value-objects/username.js';
import { UserStatus } from '../value-objects/user-status.js';

/** Input for registering a new user. */
export interface RegisterUserInput {
  /** The tenant (company) the user belongs to. */
  tenantId: TenantId;
  /** The email address. */
  email: string;
  /** The username. */
  username: string;
  /** The raw password (validated and hashed here). */
  password: string;
  /** The display name. */
  displayName: string;
  /** Optional job title. */
  title?: string;
  /** Optional bio. */
  bio?: string;
  /** Optional initial status (defaults to `pending`). */
  status?: string;
}

/** The outcome of a user command: the aggregate plus emitted events. */
export interface UserCommandResult {
  /** The mutated aggregate. */
  user: User;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link UserDomainService}. */
export interface UserDomainServiceDependencies {
  /** User persistence. */
  users: UserRepository;
  /** Role persistence (role assignment validates role existence). */
  roles: RoleRepository;
  /** Session persistence (deactivation ends active sessions). */
  sessions: SessionRepository;
  /** Password hashing port. */
  hasher: PasswordHasher;
  /** User lifecycle policy (password strength, transitions). */
  policy?: UserLifecyclePolicy;
}

/**
 * The user lifecycle use-case service. All methods return a `Result` so
 * expected failures are explicit values, not exceptions.
 */
export class UserDomainService {
  readonly #users: UserRepository;
  readonly #roles: RoleRepository;
  readonly #sessions: SessionRepository;
  readonly #hasher: PasswordHasher;
  readonly #policy: UserLifecyclePolicy;

  constructor(dependencies: UserDomainServiceDependencies) {
    this.#users = dependencies.users;
    this.#roles = dependencies.roles;
    this.#sessions = dependencies.sessions;
    this.#hasher = dependencies.hasher;
    this.#policy = dependencies.policy ?? new UserLifecyclePolicy();
  }

  /**
   * Registers a new user: validates uniqueness and password strength, hashes
   * the password, creates the aggregate, and persists it.
   */
  async register(
    input: RegisterUserInput,
    context: IdentityEventContext,
  ): Promise<Result<UserCommandResult, InvalidIdentityValueError | UserAlreadyExistsError>> {
    try {
      const email = Email.create(input.email);
      const username = Username.create(input.username);
      const displayName = DisplayName.create(input.displayName);

      const passwordIssues = this.#policy.validatePassword(input.password);
      if (passwordIssues.length > 0) {
        return err(new InvalidIdentityValueError('Weak password', passwordIssues));
      }

      if (await this.#users.existsByEmail(email, input.tenantId)) {
        return err(new UserAlreadyExistsError({ tenantId: input.tenantId, field: 'email' }));
      }
      if (await this.#users.existsByUsername(username, input.tenantId)) {
        return err(new UserAlreadyExistsError({ tenantId: input.tenantId, field: 'username' }));
      }

      const passwordHash = await this.#hasher.hash(input.password);
      const user = User.create(
        {
          tenantId: input.tenantId,
          email,
          username,
          passwordHash,
          displayName,
          title: input.title,
          bio: input.bio,
          status: input.status === undefined ? undefined : UserStatus.from(input.status),
        },
        context,
      );

      await this.#users.save(user);
      return ok({ user, events: user.pullDomainEvents() });
    } catch (error) {
      return err(toIdentityError(error) as InvalidIdentityValueError | UserAlreadyExistsError);
    }
  }

  /**
   * Activates a user (`pending`/`suspended` → `active`).
   */
  async activate(
    userId: UserId,
    context: IdentityEventContext,
  ): Promise<Result<UserCommandResult, UserNotFoundError | UserStateTransitionError>> {
    try {
      const user = await this.#requireUser(userId);
      this.#policy.assertCanTransition(user.status, UserStatus.active());
      user.activate(context);
      await this.#users.save(user);
      return ok({ user, events: user.pullDomainEvents() });
    } catch (error) {
      return err(toIdentityError(error) as UserNotFoundError | UserStateTransitionError);
    }
  }

  /**
   * Suspends a user (`active` → `suspended`) and ends all of their active
   * sessions: a suspended user must not retain access until reactivated.
   */
  async suspend(
    userId: UserId,
    reason: string,
    context: IdentityEventContext,
  ): Promise<Result<UserCommandResult, UserNotFoundError | UserStateTransitionError>> {
    try {
      const user = await this.#requireUser(userId);
      this.#policy.assertCanTransition(user.status, UserStatus.suspended());
      user.suspend(reason, context);

      const activeSessions = await this.#sessions.findActiveByUser(userId);
      for (const session of activeSessions) {
        session.end(context, `user-suspended: ${reason}`);
        await this.#sessions.save(session);
      }

      await this.#users.save(user);
      const events: EventEnvelope[] = [...user.pullDomainEvents()];
      for (const session of activeSessions) {
        events.push(...session.pullDomainEvents());
      }
      return ok({ user, events });
    } catch (error) {
      return err(toIdentityError(error) as UserNotFoundError | UserStateTransitionError);
    }
  }

  /**
   * Deactivates a user and ends all of their active sessions.
   */
  async deactivate(
    userId: UserId,
    reason: string,
    context: IdentityEventContext,
  ): Promise<Result<UserCommandResult, UserNotFoundError | UserStateTransitionError>> {
    try {
      const user = await this.#requireUser(userId);
      this.#policy.assertCanTransition(user.status, UserStatus.deactivated());
      user.deactivate(reason, context);

      const activeSessions = await this.#sessions.findActiveByUser(userId);
      for (const session of activeSessions) {
        session.end(context, `user-deactivated: ${reason}`);
        await this.#sessions.save(session);
      }

      await this.#users.save(user);
      const events: EventEnvelope[] = [...user.pullDomainEvents()];
      for (const session of activeSessions) {
        events.push(...session.pullDomainEvents());
      }
      return ok({ user, events });
    } catch (error) {
      return err(toIdentityError(error) as UserNotFoundError | UserStateTransitionError);
    }
  }

  /**
   * Assigns a role to a user. The role must exist.
   */
  async assignRole(
    userId: UserId,
    roleName: string,
    context: IdentityEventContext,
  ): Promise<Result<UserCommandResult, UserNotFoundError | RoleNotFoundError>> {
    try {
      const user = await this.#requireUser(userId);
      const role = await this.#roles.findByName(roleName);
      if (role === undefined) {
        throw new RoleNotFoundError({ role: roleName });
      }
      user.assignRole(role.name, context);
      await this.#users.save(user);
      return ok({ user, events: user.pullDomainEvents() });
    } catch (error) {
      return err(toIdentityError(error) as UserNotFoundError | RoleNotFoundError);
    }
  }

  /**
   * Removes a role from a user.
   */
  async removeRole(
    userId: UserId,
    roleName: string,
    context: IdentityEventContext,
  ): Promise<Result<UserCommandResult, UserNotFoundError>> {
    try {
      const user = await this.#requireUser(userId);
      user.removeRole(roleName, context);
      await this.#users.save(user);
      return ok({ user, events: user.pullDomainEvents() });
    } catch (error) {
      return err(toIdentityError(error) as UserNotFoundError);
    }
  }

  /**
   * Updates a user's profile.
   */
  async updateProfile(
    userId: UserId,
    update: UserProfileUpdate,
  ): Promise<Result<UserCommandResult, UserNotFoundError>> {
    try {
      const user = await this.#requireUser(userId);
      user.updateProfile(update);
      await this.#users.save(user);
      return ok({ user, events: user.pullDomainEvents() });
    } catch (error) {
      return err(toIdentityError(error) as UserNotFoundError);
    }
  }

  /**
   * Changes a user's password. Verifies the current password and validates
   * the new one against the policy before hashing.
   */
  async changePassword(
    userId: UserId,
    currentPassword: string,
    newPassword: string,
  ): Promise<
    Result<
      UserCommandResult,
      UserNotFoundError | InvalidIdentityValueError | InvalidCredentialsError
    >
  > {
    try {
      const user = await this.#requireUser(userId);
      const verified = await this.#hasher.verify(currentPassword, user.passwordHash);
      if (!verified) {
        // An incorrect current password is an authentication failure, not a
        // validation problem (same semantics as the login boundary).
        return err(new InvalidCredentialsError({ userId }));
      }
      const passwordIssues = this.#policy.validatePassword(newPassword);
      if (passwordIssues.length > 0) {
        return err(new InvalidIdentityValueError('Weak password', passwordIssues));
      }
      const newHash = await this.#hasher.hash(newPassword);
      user.changePassword(newHash);
      await this.#users.save(user);
      return ok({ user, events: user.pullDomainEvents() });
    } catch (error) {
      return err(
        toIdentityError(error) as
          UserNotFoundError | InvalidIdentityValueError | InvalidCredentialsError,
      );
    }
  }

  /** Finds a user by id, or returns a {@link UserNotFoundError}. */
  async findById(userId: UserId): Promise<Result<User, UserNotFoundError>> {
    const user = await this.#users.findById(userId);
    if (user === undefined) {
      return err(new UserNotFoundError({ userId }));
    }
    return ok(user);
  }

  /** Loads a user or throws {@link UserNotFoundError}. */
  async #requireUser(userId: UserId): Promise<User> {
    const user = await this.#users.findById(userId);
    if (user === undefined) {
      throw new UserNotFoundError({ userId });
    }
    return user;
  }
}
