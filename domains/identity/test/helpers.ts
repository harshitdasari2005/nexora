/**
 * In-memory repository fakes and test builders for the identity domain
 * tests. These implement the domain repository interfaces without
 * persistence; they are test-only and never shipped.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';

import type { User } from '../src/entities/user.js';
import type { Session } from '../src/entities/session.js';
import type { Role } from '../src/entities/role.js';
import type {
  PasswordHasher,
  RoleRepository,
  SessionRepository,
  UserRepository,
} from '../src/repositories/index.js';
import type { Email } from '../src/value-objects/email.js';
import { PasswordHash } from '../src/value-objects/password-hash.js';
import type { Username } from '../src/value-objects/username.js';
import type { IdentityEventContext } from '../src/events/index.js';

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

  async findByUsername(username: Username): Promise<User | undefined> {
    for (const user of this.users.values()) {
      if (user.username.equals(username)) {
        return user;
      }
    }
    return undefined;
  }

  async existsByEmail(email: Email, tenantId: TenantId): Promise<boolean> {
    for (const user of this.users.values()) {
      if (user.tenantId === tenantId && user.email.equals(email)) {
        return true;
      }
    }
    return false;
  }

  async existsByUsername(username: Username, tenantId: TenantId): Promise<boolean> {
    for (const user of this.users.values()) {
      if (user.tenantId === tenantId && user.username.equals(username)) {
        return true;
      }
    }
    return false;
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

  async findByToken(token: string): Promise<Session | undefined> {
    return this.byToken.get(token);
  }

  async findActiveByUser(userId: UserId): Promise<readonly Session[]> {
    return [...this.sessions.values()].filter(
      (session) => session.userId === userId && session.status.isActive(),
    );
  }

  async countActiveByUser(userId: UserId): Promise<number> {
    return (await this.findActiveByUser(userId)).length;
  }

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    this.byToken.set(session.token, session);
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

  async listByTenant(tenantId: TenantId): Promise<readonly Role[]> {
    return [...this.roles.values()].filter(
      (role) => role.tenantId === undefined || role.tenantId === tenantId,
    );
  }

  async save(role: Role): Promise<void> {
    this.roles.set(role.name, role);
  }
}

/** A reversible test hasher: `hash = 'test:' + plain`. Never use in prod. */
export class TestPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<PasswordHash> {
    return PasswordHash.create('scrypt', `test:${plain}`);
  }

  async verify(plain: string, hash: PasswordHash): Promise<boolean> {
    return hash.hash === `test:${plain}`;
  }
}

/** A reusable event context for tests. */
export function testContext(overrides: Partial<IdentityEventContext> = {}): IdentityEventContext {
  return {
    actor: { kind: 'user', id: 'usr_system' },
    correlationId: 'corr_test',
    tenantId: 'tenant_1' as TenantId,
    ...overrides,
  };
}
