/**
 * Test-only fakes for the identity application layer: in-memory repository
 * implementations and a recording {@link EventPublisher}. These implement
 * the domain ports without persistence and are never shipped.
 */

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import type { TenantId, UserId } from '@nexora/contracts/common';

import type {
  PasswordHasher,
  RoleRepository,
  SessionLivenessWindow,
  SessionRepository,
  UserRepository,
} from '@nexora/domain-identity';
import {
  isSessionLive,
  PasswordHash,
  type Email,
  type Role,
  type Session,
  User,
  type Username,
} from '@nexora/domain-identity';

/** An in-memory {@link UserRepository}. */
export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<UserId, User>();

  async findById(id: UserId): Promise<User | undefined> {
    return this.users.get(id);
  }

  async findByEmail(email: Email): Promise<User | undefined> {
    for (const user of this.users.values()) {
      if (user.email.equals(email)) {
        return user;
      }
    }
    return undefined;
  }

  async findByOidcIdentity(issuer: string, subject: string): Promise<User | undefined> {
    for (const user of this.users.values()) {
      if (user.oidcIssuer === issuer && user.oidcSubject === subject) {
        return user;
      }
    }
    return undefined;
  }

  async bindOidcIdentity(userId: UserId, issuer: string, subject: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (user === undefined || user.oidcIssuer !== undefined) {
      return false; // missing, or already bound: first-wins, never overwritten
    }
    // Check-and-set with NO await in between: atomic, like the single conditional UPDATE in Postgres.
    for (const other of this.users.values()) {
      if (other.oidcIssuer === issuer && other.oidcSubject === subject) {
        return false; // that identity belongs to someone else (the unique index in Postgres)
      }
    }
    // The in-memory aggregate is immutable here: replace it with a bound copy.
    const bound = User.hydrate({
      ...User.snapshot(user),
      oidcIssuer: issuer,
      oidcSubject: subject,
    });
    this.users.set(userId, bound);
    return true;
  }

  async findByUsername(username: Username): Promise<User | undefined> {
    for (const user of this.users.values()) {
      if (user.username.equals(username)) {
        return user;
      }
    }
    return undefined;
  }

  async existsByEmail(email: Email, tenantId: TenantId): Promise<boolean> {
    return this.findByEmail(email).then((user) => user?.tenantId === tenantId);
  }

  async existsByUsername(username: Username, tenantId: TenantId): Promise<boolean> {
    return this.findByUsername(username).then((user) => user?.tenantId === tenantId);
  }

  async save(user: User): Promise<void> {
    this.users.set(user.id, user);
  }
}

/** An in-memory {@link SessionRepository}. */
export class InMemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, Session>();
  readonly byToken = new Map<string, Session>();

  async findById(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async findByTokenHash(tokenHash: string): Promise<Session | undefined> {
    return this.byToken.get(tokenHash);
  }

  async findActiveByUser(userId: UserId): Promise<readonly Session[]> {
    return [...this.sessions.values()].filter(
      (session) => session.userId === userId && session.status.isActive(),
    );
  }

  async countActiveByUser(userId: UserId, window: SessionLivenessWindow): Promise<number> {
    return (await this.findActiveByUser(userId)).filter((session) => isSessionLive(session, window))
      .length;
  }

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    this.byToken.set(session.tokenHash, session);
  }
}

/** An in-memory {@link RoleRepository}. */
export class InMemoryRoleRepository implements RoleRepository {
  readonly roles = new Map<string, Role>();

  async findByName(name: string): Promise<Role | undefined> {
    return this.roles.get(name);
  }

  async findById(id: string): Promise<Role | undefined> {
    for (const role of this.roles.values()) {
      if (role.id === id) {
        return role;
      }
    }
    return undefined;
  }

  async listByTenant(_tenantId: TenantId): Promise<readonly Role[]> {
    return [...this.roles.values()];
  }

  async save(role: Role): Promise<void> {
    this.roles.set(role.name, role);
  }
}

/** A reversible test hasher — never use in production. */
export class TestPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<PasswordHash> {
    return PasswordHash.create('scrypt', `test:${plain}`);
  }

  async verify(plain: string, hash: PasswordHash): Promise<boolean> {
    return hash.hash === `test:${plain}`;
  }
}

/** Records published events for assertions. */
export class RecordingEventPublisher implements EventPublisher {
  readonly published: readonly EventEnvelope[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    (this.published as EventEnvelope[]).push(...events);
  }

  /** The event types published so far. */
  get types(): readonly string[] {
    return this.published.map((event) => event.type);
  }
}
