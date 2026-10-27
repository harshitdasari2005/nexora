/**
 * @nexora/domain-identity — repository interfaces & ports.
 *
 * The persistence contracts the Identity domain depends on (DDD.md §6, §7;
 * PERSISTENCE.md §4 aggregate ownership). Interfaces only — the
 * infrastructure layer provides implementations. The `PasswordHasher` is a
 * domain port: the domain defines the contract, infrastructure supplies the
 * hashing implementation (SAD.md §13.6).
 */

import type { TenantId, UserId } from '@nexora/contracts/common';

import type { User } from '../entities/user.js';
import type { Session } from '../entities/session.js';
import type { SessionLivenessWindow } from '../policies/index.js';
import type { Role } from '../entities/role.js';
import type { Email } from '../value-objects/email.js';
import type { Username } from '../value-objects/username.js';
import type { PasswordHash } from '../value-objects/password-hash.js';

/**
 * Persistence contract for the {@link User} aggregate. The aggregate is the
 * transaction boundary: save persists the whole aggregate (user + profile +
 * roles) atomically.
 */
export interface UserRepository {
  /** Finds a user by id, or `undefined`. */
  findById(id: UserId): Promise<User | undefined>;
  /** Finds a user by email, or `undefined`. */
  findByEmail(email: Email): Promise<User | undefined>;
  /** Finds a user by username, or `undefined`. */
  findByUsername(username: Username): Promise<User | undefined>;
  /** Whether a user with the email exists in the tenant. */
  existsByEmail(email: Email, tenantId: TenantId): Promise<boolean>;
  /** Whether a user with the username exists in the tenant. */
  existsByUsername(username: Username, tenantId: TenantId): Promise<boolean>;
  /**
   * Finds the user bound to the external identity `(issuer, subject)` (AUTH-009),
   * or `undefined`. An exact match on both values through the composite unique
   * index — never an email fallback.
   */
  findByOidcIdentity(issuer: string, subject: string): Promise<User | undefined>;
  /**
   * Binds `(issuer, subject)` to a user that has NO binding yet. Atomic and
   * first-wins: it succeeds (`true`) only if the user is still unbound AND the
   * identity is not bound to anyone else; otherwise nothing changes and it
   * returns `false`. It never overwrites an existing binding.
   */
  bindOidcIdentity(userId: UserId, issuer: string, subject: string): Promise<boolean>;
  /**
   * Persists the user aggregate (insert or update). The OIDC binding is written
   * on INSERT only: an update never changes or clears it (use
   * {@link UserRepository.bindOidcIdentity}).
   */
  save(user: User): Promise<void>;
}

/**
 * Persistence contract for the {@link Session} aggregate.
 */
export interface SessionRepository {
  /** Finds a session by id, or `undefined`. */
  findById(id: string): Promise<Session | undefined>;
  /**
   * Finds a session by the SHA-256 digest of its bearer token (AUTH-004): the
   * raw token is never stored or queried. An exact, indexed lookup.
   */
  findByTokenHash(tokenHash: string): Promise<Session | undefined>;
  /** Lists the active sessions of a user. */
  findActiveByUser(userId: UserId): Promise<readonly Session[]>;
  /**
   * Counts the user's LIVE sessions: status `active` AND inside the liveness
   * window (not past absolute expiry, not idle-expired). A session whose
   * lifetime has passed but that was never presented again still has status
   * `active`; it must not consume a concurrency slot.
   */
  countActiveByUser(userId: UserId, window: SessionLivenessWindow): Promise<number>;
  /** Persists the session aggregate (insert or update). */
  save(session: Session): Promise<void>;
}

/**
 * Persistence contract for the {@link Role} aggregate.
 */
export interface RoleRepository {
  /** Finds a role by name, or `undefined`. */
  findByName(name: string): Promise<Role | undefined>;
  /** Finds a role by id, or `undefined`. */
  findById(id: string): Promise<Role | undefined>;
  /** Lists all roles visible to the tenant. */
  listByTenant(tenantId: TenantId): Promise<readonly Role[]>;
  /** Persists the role aggregate (insert or update). */
  save(role: Role): Promise<void>;
}

/**
 * The password hashing port. The domain never hashes or compares plaintext
 * itself — it delegates to this contract, which the infrastructure layer
 * implements with a one-way KDF (e.g. argon2id, SAD.md §13.6).
 */
export interface PasswordHasher {
  /** Hashes a plaintext password into a {@link PasswordHash}. */
  hash(plain: string): Promise<PasswordHash>;
  /** Verifies a plaintext password against a stored hash. */
  verify(plain: string, hash: PasswordHash): Promise<boolean>;
}
