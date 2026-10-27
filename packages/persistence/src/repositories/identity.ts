/**
 * @nexora/persistence — identity repositories.
 *
 * Drizzle implementations of the Identity domain repository interfaces
 * (`UserRepository`, `SessionRepository`, `RoleRepository`). Aggregates are
 * serialized via their `snapshot()` factories and reconstructed via
 * `hydrate()` (PERSISTENCE.md §4). Child state lives in JSONB documents.
 */

import { and, eq, gt, gte, isNull, or } from 'drizzle-orm';
import type {
  RoleRepository,
  SessionLivenessWindow,
  SessionRepository,
  UserRepository,
} from '@nexora/domain-identity';
import { PasswordHash, Role, Session, User } from '@nexora/domain-identity';
import type { Email, PasswordAlgorithm, Username } from '@nexora/domain-identity';
import type { TenantId, UserId } from '@nexora/contracts/common';

import type { NexoraDatabase } from '../db.js';
import { roles, sessions, users } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

/** The row shape for the users table. */
type UserRow = typeof users.$inferSelect;
/** The row shape for the sessions table. */
type SessionRow = typeof sessions.$inferSelect;
/** The row shape for the roles table. */
type RoleRow = typeof roles.$inferSelect;

/** Maps a users row to a {@link User} snapshot. */
function rowToUserSnapshot(row: UserRow): ReturnType<typeof User.snapshot> {
  return {
    id: row.id as UserId,
    tenantId: row.tenantId as TenantId,
    email: row.email,
    username: row.username,
    passwordHash: PasswordHash.create(row.passwordAlgorithm as PasswordAlgorithm, row.passwordHash),
    status: row.status,
    profile: row.profile as UserRow['profile'] & {
      displayName: string;
      updatedAt: string;
    },
    oidcIssuer: row.oidcIssuer ?? undefined,
    oidcSubject: row.oidcSubject ?? undefined,
    roles: row.roles as readonly string[],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Maps a {@link User} snapshot to a users row. */
function userSnapshotToRow(snapshot: ReturnType<typeof User.snapshot>): UserRow {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    email: snapshot.email,
    username: snapshot.username,
    passwordAlgorithm: snapshot.passwordHash.algorithm,
    passwordHash: snapshot.passwordHash.hash,
    status: snapshot.status,
    profile: snapshot.profile,
    oidcIssuer: snapshot.oidcIssuer ?? null,
    oidcSubject: snapshot.oidcSubject ?? null,
    roles: snapshot.roles,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link UserRepository} implementation. */
export class PgUserRepository implements UserRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: UserId): Promise<User | undefined> {
    const row = await this.#db.query.users.findFirst({ where: eq(users.id, id) });
    return row === undefined ? undefined : User.hydrate(rowToUserSnapshot(row));
  }

  async findByEmail(email: Email): Promise<User | undefined> {
    const row = await this.#db.query.users.findFirst({
      where: eq(users.email, email.value),
    });
    return row === undefined ? undefined : User.hydrate(rowToUserSnapshot(row));
  }

  async findByUsername(username: Username): Promise<User | undefined> {
    const row = await this.#db.query.users.findFirst({
      where: eq(users.username, username.value),
    });
    return row === undefined ? undefined : User.hydrate(rowToUserSnapshot(row));
  }

  async existsByEmail(email: Email, tenantId: TenantId): Promise<boolean> {
    const row = await this.#db.query.users.findFirst({
      where: and(eq(users.email, email.value), eq(users.tenantId, tenantId)),
    });
    return row !== undefined;
  }

  async existsByUsername(username: Username, tenantId: TenantId): Promise<boolean> {
    const row = await this.#db.query.users.findFirst({
      where: and(eq(users.username, username.value), eq(users.tenantId, tenantId)),
    });
    return row !== undefined;
  }

  async findByOidcIdentity(issuer: string, subject: string): Promise<User | undefined> {
    // Exact match on the composite partial unique index `users_oidc_identity_unique`;
    // deliberately no email fallback.
    const row = await this.#db.query.users.findFirst({
      where: and(eq(users.oidcIssuer, issuer), eq(users.oidcSubject, subject)),
    });
    return row === undefined ? undefined : User.hydrate(rowToUserSnapshot(row));
  }

  async bindOidcIdentity(userId: UserId, issuer: string, subject: string): Promise<boolean> {
    try {
      // One conditional UPDATE: only an UNBOUND user can be bound, so of two
      // concurrent first logins exactly one matches the WHERE and wins; the
      // unique index rejects an identity already bound to another account.
      const updated = await this.#db
        .update(users)
        .set({ oidcIssuer: issuer, oidcSubject: subject, updatedAt: new Date() })
        .where(and(eq(users.id, userId), isNull(users.oidcIssuer), isNull(users.oidcSubject)))
        .returning({ id: users.id });
      return updated.length === 1;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  async save(user: User): Promise<void> {
    const row = userSnapshotToRow(User.snapshot(user));
    // The OIDC binding is written on INSERT only. An UPDATE (profile, status,
    // roles…) from an aggregate loaded before a login bound the account must
    // never overwrite or clear that binding.
    const { oidcIssuer: _issuer, oidcSubject: _subject, ...mutable } = row;
    void _issuer;
    void _subject;
    await this.#db.insert(users).values(row).onConflictDoUpdate({ target: users.id, set: mutable });
  }
}

/** Whether a driver error is a PostgreSQL unique-constraint violation (23505). */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Maps a sessions row to a {@link Session} snapshot. */
function rowToSessionSnapshot(row: SessionRow): ReturnType<typeof Session.snapshot> {
  return {
    id: row.id,
    userId: row.userId as UserId,
    tenantId: row.tenantId as TenantId,
    tokenHash: row.tokenHash,
    status: row.status,
    issuedAt: toIso(row.issuedAt),
    expiresAt: toIso(row.expiresAt),
    lastUsedAt: toIso(row.lastUsedAt),
    endedAt: row.endedAt === null ? undefined : toIso(row.endedAt),
    version: row.version,
  };
}

/** Maps a {@link Session} snapshot to a sessions row. */
function sessionSnapshotToRow(snapshot: ReturnType<typeof Session.snapshot>): SessionRow {
  return {
    id: snapshot.id,
    userId: snapshot.userId,
    tenantId: snapshot.tenantId,
    tokenHash: snapshot.tokenHash,
    status: snapshot.status,
    issuedAt: toDate(snapshot.issuedAt),
    expiresAt: toDate(snapshot.expiresAt),
    lastUsedAt: toDate(snapshot.lastUsedAt),
    endedAt: snapshot.endedAt === undefined ? null : toDate(snapshot.endedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link SessionRepository} implementation. */
export class PgSessionRepository implements SessionRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: string): Promise<Session | undefined> {
    const row = await this.#db.query.sessions.findFirst({ where: eq(sessions.id, id) });
    return row === undefined ? undefined : Session.hydrate(rowToSessionSnapshot(row));
  }

  async findByTokenHash(tokenHash: string): Promise<Session | undefined> {
    // Exact lookup on the unique `sessions_token_hash_unique` index.
    const row = await this.#db.query.sessions.findFirst({
      where: eq(sessions.tokenHash, tokenHash),
    });
    return row === undefined ? undefined : Session.hydrate(rowToSessionSnapshot(row));
  }

  async findActiveByUser(userId: UserId): Promise<readonly Session[]> {
    const rows = await this.#db.query.sessions.findMany({
      where: and(eq(sessions.userId, userId), eq(sessions.status, 'active')),
    });
    return rows.map((row) => Session.hydrate(rowToSessionSnapshot(row)));
  }

  async countActiveByUser(userId: UserId, window: SessionLivenessWindow): Promise<number> {
    // LIVE = status active AND the same two comparisons session validation
    // applies (`isSessionLive`): not past absolute expiry, not idle-expired.
    const rows = await this.#db.query.sessions.findMany({
      where: and(
        eq(sessions.userId, userId),
        eq(sessions.status, 'active'),
        gt(sessions.expiresAt, new Date(window.now)),
        gte(sessions.lastUsedAt, new Date(window.idleSince)),
      ),
    });
    return rows.length;
  }

  async save(session: Session): Promise<void> {
    const row = sessionSnapshotToRow(Session.snapshot(session));
    await this.#db
      .insert(sessions)
      .values(row)
      .onConflictDoUpdate({ target: sessions.id, set: row });
  }
}

/** Maps a roles row to a {@link Role} snapshot. */
function rowToRoleSnapshot(row: RoleRow): ReturnType<typeof Role.snapshot> {
  return {
    id: row.id,
    name: row.name,
    level: row.level as 'global' | 'workspace' | 'application',
    tenantId: row.tenantId === null ? undefined : (row.tenantId as TenantId),
    approver: row.approver,
    description: row.description ?? undefined,
    permissions: row.permissions as ReturnType<typeof Role.snapshot>['permissions'],
    createdAt: toIso(row.createdAt),
    version: row.version,
  };
}

/** Maps a {@link Role} snapshot to a roles row. */
function roleSnapshotToRow(snapshot: ReturnType<typeof Role.snapshot>): RoleRow {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId ?? null,
    name: snapshot.name,
    level: snapshot.level,
    approver: snapshot.approver,
    description: snapshot.description ?? null,
    permissions: snapshot.permissions,
    createdAt: toDate(snapshot.createdAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link RoleRepository} implementation. */
export class PgRoleRepository implements RoleRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findByName(name: string): Promise<Role | undefined> {
    const row = await this.#db.query.roles.findFirst({ where: eq(roles.name, name) });
    return row === undefined ? undefined : Role.hydrate(rowToRoleSnapshot(row));
  }

  async findById(id: string): Promise<Role | undefined> {
    const row = await this.#db.query.roles.findFirst({ where: eq(roles.id, id) });
    return row === undefined ? undefined : Role.hydrate(rowToRoleSnapshot(row));
  }

  async listByTenant(tenantId: TenantId): Promise<readonly Role[]> {
    // Tenant isolation: a tenant sees its own roles plus platform-global
    // templates (tenant_id IS NULL).
    const rows = await this.#db.query.roles.findMany({
      where: or(eq(roles.tenantId, tenantId), isNull(roles.tenantId)),
    });
    return rows.map((row) => Role.hydrate(rowToRoleSnapshot(row)));
  }

  async save(role: Role): Promise<void> {
    const row = roleSnapshotToRow(Role.snapshot(role));
    await this.#db.insert(roles).values(row).onConflictDoUpdate({ target: roles.id, set: row });
  }
}
