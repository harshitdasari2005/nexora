/**
 * @nexora/domain-identity — User aggregate root.
 *
 * The central Identity aggregate (DDD.md §6, DOMAIN_MODEL.md §2.2). Owns the
 * profile (child entity), email, username, password hash, status, and role
 * references. All state changes flow through aggregate methods, which
 * enforce business invariants and record domain events.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, UserId } from '@nexora/contracts/common';

import type { IdentityEventContext } from '../events/index.js';
import {
  roleAssignedEvent,
  roleRemovedEvent,
  userActivatedEvent,
  userCreatedEvent,
  userDeactivatedEvent,
  userSuspendedEvent,
} from '../events/index.js';
import {
  RoleAlreadyAssignedError,
  RoleNotAssignedError,
  UserStateTransitionError,
} from '../errors/index.js';
import { USER_TRANSITIONS } from '../policies/index.js';
import { DisplayName } from '../value-objects/display-name.js';
import { Email } from '../value-objects/email.js';
import type { PasswordHash } from '../value-objects/password-hash.js';
import { Username } from '../value-objects/username.js';
import { UserStatus } from '../value-objects/user-status.js';
import { UserProfile } from './user-profile.js';

/** Input for creating a new {@link User}. */
export interface CreateUserInput {
  /** The tenant (company) the user belongs to. */
  tenantId: TenantId;
  /** The validated email address. */
  email: Email;
  /** The validated username. */
  username: Username;
  /** The password hash (created by a `PasswordHasher` port). */
  passwordHash: PasswordHash;
  /** The validated display name. */
  displayName: DisplayName;
  /** Optional job title for the profile. */
  title?: string;
  /** Optional bio for the profile. */
  bio?: string;
  /** Optional initial status (defaults to `pending`). */
  status?: UserStatus;
}

/**
 * A persistence snapshot of the {@link User} aggregate (PERSISTENCE.md §4
 * aggregate ownership). Plain data produced by {@link User.snapshot} and
 * consumed by {@link User.hydrate} — no behavior.
 */
export interface UserSnapshot {
  /** The user id. */
  id: UserId;
  /** The tenant the user belongs to. */
  tenantId: TenantId;
  /** The email address. */
  email: string;
  /** The username. */
  username: string;
  /** The password hash (VO value). */
  passwordHash: PasswordHash;
  /** The lifecycle status value. */
  status: string;
  /** The owned profile data. */
  profile: {
    /** The display name. */
    displayName: string;
    /** The optional job title. */
    title?: string;
    /** The optional bio. */
    bio?: string;
    /** ISO-8601 UTC profile update time. */
    updatedAt: string;
  };
  /** Role names currently assigned. */
  roles: readonly string[];
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link User} aggregate root. Use {@link User.create} to construct;
 * mutate only through aggregate methods so invariants stay protected.
 */
export class User {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: UserId;
  readonly #tenantId: TenantId;
  #email: Email;
  #username: Username;
  #passwordHash: PasswordHash;
  #profile: UserProfile;
  #status: UserStatus;
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #roles: Set<string>;
  #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateUserInput, createdAt: string) {
    this.#id = prefixedId('usr') as UserId;
    this.#tenantId = input.tenantId;
    this.#email = input.email;
    this.#username = input.username;
    this.#passwordHash = input.passwordHash;
    this.#status = input.status ?? UserStatus.pending();
    this.#profile = UserProfile.create(this.#id, {
      displayName: input.displayName.value,
      title: input.title,
      bio: input.bio,
    });
    this.#roles = new Set();
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link User} and records a {@link userCreatedEvent}.
   *
   * @param input   - creation data.
   * @param context - event context (actor, correlation id, tenant).
   * @param now     - ISO-8601 UTC creation time (defaults to now).
   */
  static create(input: CreateUserInput, context: IdentityEventContext, now = nowIso()): User {
    const user = new User(input, now);
    user.#events.push(
      userCreatedEvent(context, {
        userId: user.#id,
        email: user.#email.value,
        username: user.#username.value,
        displayName: user.#profile.displayName.value,
      }),
    );
    return user;
  }

  /** The user id. */
  get id(): UserId {
    return this.#id;
  }

  /** The tenant (company) the user belongs to. */
  get tenantId(): TenantId {
    return this.#tenantId;
  }

  /** The email address. */
  get email(): Email {
    return this.#email;
  }

  /** The username. */
  get username(): Username {
    return this.#username;
  }

  /** The password hash. */
  get passwordHash(): PasswordHash {
    return this.#passwordHash;
  }

  /** The profile (owned child entity). */
  get profile(): UserProfile {
    return this.#profile;
  }

  /** The lifecycle status. */
  get status(): UserStatus {
    return this.#status;
  }

  /** Role names currently assigned to the user (references). */
  get roles(): readonly string[] {
    return [...this.#roles];
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time of the last mutation. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version for optimistic concurrency (EntityMeta). */
  get version(): number {
    return this.#version;
  }

  /** Whether the user may authenticate. */
  isActive(): boolean {
    return this.#status.isActive();
  }

  /** Whether the user holds the given role. */
  hasRole(role: string): boolean {
    return this.#roles.has(role);
  }

  /**
   * Activates the user (`pending`/`suspended` → `active`) and records a
   * {@link userActivatedEvent}.
   *
   * @param context - event context.
   * @param now     - ISO-8601 UTC mutation time (defaults to now).
   * @throws {UserStateTransitionError} when the transition is not allowed.
   */
  activate(context: IdentityEventContext, now = nowIso()): void {
    this.#transitionTo(UserStatus.active(), 'activate', now);
    this.#events.push(userActivatedEvent(context, { userId: this.#id }));
  }

  /**
   * Suspends the user (`active` → `suspended`) and records a
   * {@link userSuspendedEvent}. Suspension is a reversible administrative
   * hold: the user can no longer authenticate or act, but keeps their
   * identity and can be reactivated via {@link activate}.
   *
   * @param reason  - why the user is being suspended.
   * @param context - event context.
   * @param now     - ISO-8601 UTC mutation time (defaults to now).
   * @throws {UserStateTransitionError} when the transition is not allowed.
   */
  suspend(reason: string, context: IdentityEventContext, now = nowIso()): void {
    this.#transitionTo(UserStatus.suspended(), 'suspend', now);
    this.#events.push(userSuspendedEvent(context, { userId: this.#id, reason }));
  }

  /**
   * Deactivates the user (`active`/`suspended` → `deactivated`) and records a
   * {@link userDeactivatedEvent}.
   *
   * @param reason  - why the user is being deactivated.
   * @param context - event context.
   * @param now     - ISO-8601 UTC mutation time (defaults to now).
   * @throws {UserStateTransitionError} when the transition is not allowed.
   */
  deactivate(reason: string, context: IdentityEventContext, now = nowIso()): void {
    this.#transitionTo(UserStatus.deactivated(), 'deactivate', now);
    this.#events.push(userDeactivatedEvent(context, { userId: this.#id, reason }));
  }

  /**
   * Assigns a role to the user and records a {@link roleAssignedEvent}.
   *
   * @param role    - the role name to assign.
   * @param context - event context.
   * @throws {RoleAlreadyAssignedError} when the role is already assigned.
   */
  assignRole(role: string, context: IdentityEventContext): void {
    if (this.#roles.has(role)) {
      throw new RoleAlreadyAssignedError({ userId: this.#id, role });
    }
    this.#roles.add(role);
    this.#bump();
    this.#events.push(roleAssignedEvent(context, { userId: this.#id, role }));
  }

  /**
   * Removes a role from the user and records a {@link roleRemovedEvent}.
   *
   * @param role    - the role name to remove.
   * @param context - event context.
   * @throws {RoleNotAssignedError} when the role is not assigned.
   */
  removeRole(role: string, context: IdentityEventContext): void {
    if (!this.#roles.has(role)) {
      throw new RoleNotAssignedError({ userId: this.#id, role });
    }
    this.#roles.delete(role);
    this.#bump();
    this.#events.push(roleRemovedEvent(context, { userId: this.#id, role }));
  }

  /**
   * Updates the user's profile.
   *
   * @param update - the new profile values.
   * @param now    - ISO-8601 UTC mutation time (defaults to now).
   * @throws {InvalidIdentityValueError} when the display name is invalid.
   */
  updateProfile(update: Parameters<UserProfile['update']>[0], now = nowIso()): void {
    this.#profile.update(update, now);
    this.#bump(now);
  }

  /**
   * Replaces the password hash.
   *
   * @param passwordHash - the new hash (from a `PasswordHasher` port).
   * @param now          - ISO-8601 UTC mutation time (defaults to now).
   */
  changePassword(passwordHash: PasswordHash, now = nowIso()): void {
    this.#passwordHash = passwordHash;
    this.#bump(now);
  }

  /**
   * A persistence snapshot of the {@link User} aggregate (PERSISTENCE.md §4
   * aggregate ownership). Produced by the persistence layer; consumed by
   * {@link User.hydrate}. Plain data — no behavior.
   */
  static snapshot(user: User): UserSnapshot {
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email.value,
      username: user.username.value,
      passwordHash: user.passwordHash,
      status: user.status.value,
      profile: {
        displayName: user.profile.displayName.value,
        title: user.profile.title,
        bio: user.profile.bio,
        updatedAt: user.profile.updatedAt,
      },
      roles: user.roles,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      version: user.version,
    };
  }

  /**
   * Reconstructs a {@link User} from a persistence snapshot without emitting
   * domain events (PERSISTENCE.md §4 reconstitution; DDD reconstitution
   * factory). Validates inputs through the value objects, so corrupt rows
   * fail at load.
   */
  static hydrate(snapshot: UserSnapshot): User {
    const user = new User(
      {
        tenantId: snapshot.tenantId,
        email: Email.create(snapshot.email),
        username: Username.create(snapshot.username),
        passwordHash: snapshot.passwordHash,
        displayName: DisplayName.create(snapshot.profile.displayName),
        title: snapshot.profile.title,
        bio: snapshot.profile.bio,
        status: UserStatus.from(snapshot.status),
      },
      snapshot.createdAt,
    );
    user.#id = snapshot.id;
    user.#profile = UserProfile.create(
      user.#id,
      {
        displayName: snapshot.profile.displayName,
        title: snapshot.profile.title,
        bio: snapshot.profile.bio,
      },
      snapshot.profile.updatedAt,
    );
    user.#roles = new Set(snapshot.roles);
    user.#updatedAt = snapshot.updatedAt;
    user.#version = snapshot.version;
    return user;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Enforces the user lifecycle transition table. */
  #transitionTo(target: UserStatus, action: string, now: string): void {
    const allowed = USER_TRANSITIONS[this.#status.value];
    if (!allowed.includes(target.value)) {
      throw new UserStateTransitionError(
        `Cannot ${action} a user in status ${this.#status.value}`,
        { userId: this.#id, from: this.#status.value, to: target.value },
      );
    }
    this.#status = target;
    this.#bump(now);
  }

  /** Bumps the version and updated-at timestamp (optimistic concurrency). */
  #bump(now = nowIso()): void {
    this.#version += 1;
    this.#updatedAt = now;
  }
}
