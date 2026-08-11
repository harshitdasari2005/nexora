/**
 * @nexora/persistence — identity repositories.
 *
 * Drizzle implementations of the Identity domain repository interfaces
 * (`UserRepository`, `SessionRepository`, `RoleRepository`). Aggregates are
 * serialized via their `snapshot()` factories and reconstructed via
 * `hydrate()` (PERSISTENCE.md §4). Child state lives in JSONB documents.
 */

import { and, eq, isNull, or } from 'drizzle-orm';
import type { RoleRepository, SessionRepository, UserRepository } from '@nexora/domain-identity';
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

  async save(user: User): Promise<void> {
    const row = userSnapshotToRow(User.snapshot(user));
    await this.#db.insert(users).values(row).onConflictDoUpdate({ target: users.id, set: row });
  }
}

/** Maps a sessions row to a {@link Session} snapshot. */
function rowToSessionSnapshot(row: SessionRow): ReturnType<typeof Session.snapshot> {
  return {
    id: row.id,
    userId: row.userId as UserId,
    tenantId: row.tenantId as TenantId,
    token: row.token,
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
    token: snapshot.token,
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

  async findByToken(token: string): Promise<Session | undefined> {
    const row = await this.#db.query.sessions.findFirst({
      where: eq(sessions.token, token),
    });
    return row === undefined ? undefined : Session.hydrate(rowToSessionSnapshot(row));
  }

  async findActiveByUser(userId: UserId): Promise<readonly Session[]> {
    const rows = await this.#db.query.sessions.findMany({
      where: and(eq(sessions.userId, userId), eq(sessions.status, 'active')),
    });
    return rows.map((row) => Session.hydrate(rowToSessionSnapshot(row)));
  }

  async countActiveByUser(userId: UserId): Promise<number> {
    const rows = await this.#db.query.sessions.findMany({
      where: and(eq(sessions.userId, userId), eq(sessions.status, 'active')),
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
