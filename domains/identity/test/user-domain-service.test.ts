/**
 * UserDomainService tests: registration, activation, deactivation, role
 * management, profile updates, and password changes.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import { IDENTITY_EVENT_TYPES } from '../src/events/index.js';
import {
  InvalidCredentialsError,
  InvalidIdentityValueError,
  RoleNotFoundError,
  UserAlreadyExistsError,
  UserNotFoundError,
  UserStateTransitionError,
} from '../src/errors/index.js';
import { UserDomainService } from '../src/services/index.js';
import { Role } from '../src/entities/role.js';
import { Session } from '../src/entities/session.js';
import { UserStatus } from '../src/value-objects/user-status.js';
import {
  InMemoryRoleRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  TestPasswordHasher,
  testContext,
} from './helpers.js';

const TENANT = 'tenant_1' as TenantId;
const context = testContext();

function makeService(): {
  service: UserDomainService;
  users: InMemoryUserRepository;
  roles: InMemoryRoleRepository;
  sessions: InMemorySessionRepository;
} {
  const users = new InMemoryUserRepository();
  const roles = new InMemoryRoleRepository();
  const sessions = new InMemorySessionRepository();
  const service = new UserDomainService({
    users,
    roles,
    sessions,
    hasher: new TestPasswordHasher(),
  });
  return { service, users, roles, sessions };
}

function registerInput(overrides: Partial<Parameters<UserDomainService['register']>[0]> = {}) {
  return {
    tenantId: TENANT,
    email: 'alice@example.com',
    username: 'alice',
    password: 'CorrectHorse1',
    displayName: 'Alice',
    ...overrides,
  };
}

describe('UserDomainService.register', () => {
  it('registers a user and emits UserCreated', async () => {
    const { service, users } = makeService();
    const result = await service.register(registerInput(), context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.email.value).toBe('alice@example.com');
      expect(result.value.events.map((event) => event.type)).toContain(
        IDENTITY_EVENT_TYPES.userCreated,
      );
      expect(users.users.size).toBe(1);
    }
  });

  it('defaults the user to pending status', async () => {
    const { service } = makeService();
    const result = await service.register(registerInput(), context);
    if (result.ok) {
      expect(result.value.user.status.value).toBe('pending');
    }
  });

  it('honors an explicit active status', async () => {
    const { service } = makeService();
    const result = await service.register(registerInput({ status: 'active' }), context);
    if (result.ok) {
      expect(result.value.user.isActive()).toBe(true);
    }
  });

  it('rejects a duplicate email', async () => {
    const { service } = makeService();
    await service.register(registerInput(), context);
    const result = await service.register(registerInput({ username: 'alice2' }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(UserAlreadyExistsError);
    }
  });

  it('rejects a duplicate username', async () => {
    const { service } = makeService();
    await service.register(registerInput(), context);
    const result = await service.register(registerInput({ email: 'other@example.com' }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(UserAlreadyExistsError);
    }
  });

  it('allows the same email in different tenants', async () => {
    const { service } = makeService();
    await service.register(registerInput(), context);
    const result = await service.register(
      registerInput({ tenantId: 'tenant_2' as TenantId, username: 'alice2' }),
      context,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a weak password', async () => {
    const { service } = makeService();
    const result = await service.register(registerInput({ password: 'short' }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidIdentityValueError);
    }
  });

  it('rejects an invalid email', async () => {
    const { service } = makeService();
    const result = await service.register(registerInput({ email: 'not-an-email' }), context);
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid username', async () => {
    const { service } = makeService();
    const result = await service.register(registerInput({ username: 'ab' }), context);
    expect(result.ok).toBe(false);
  });
});

describe('UserDomainService lifecycle', () => {
  async function registerActive(service: UserDomainService) {
    const result = await service.register(registerInput({ status: 'active' }), context);
    if (!result.ok) {
      throw new Error('setup failed');
    }
    return result.value.user;
  }

  it('activates a pending user', async () => {
    const { service } = makeService();
    const registered = await service.register(registerInput(), context);
    if (!registered.ok) {
      throw new Error('setup failed');
    }
    const result = await service.activate(registered.value.user.id, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.isActive()).toBe(true);
      expect(result.value.events.map((event) => event.type)).toContain(
        IDENTITY_EVENT_TYPES.userActivated,
      );
    }
  });

  it('deactivates a user and emits UserDeactivated', async () => {
    const { service } = makeService();
    const user = await registerActive(service);
    const result = await service.deactivate(user.id, 'offboarding', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.status.value).toBe('deactivated');
      expect(result.value.events.map((event) => event.type)).toContain(
        IDENTITY_EVENT_TYPES.userDeactivated,
      );
    }
  });

  it('suspends an active user and emits UserSuspended', async () => {
    const { service } = makeService();
    const user = await registerActive(service);
    const result = await service.suspend(user.id, 'policy-hold', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.status.value).toBe('suspended');
      expect(result.value.user.isActive()).toBe(false);
      expect(result.value.events.map((event) => event.type)).toContain(
        IDENTITY_EVENT_TYPES.userSuspended,
      );
    }
  });

  it('ends active sessions when suspending a user', async () => {
    const { service, sessions } = makeService();
    const user = await registerActive(service);
    const session = Session.start(
      {
        userId: user.id,
        tenantId: TENANT,
        token: 'tok-suspend-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      context,
    );
    await sessions.save(session);
    expect(session.status.value).toBe('active');
    const result = await service.suspend(user.id, 'security-hold', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events.map((event) => event.type)).toContain(
        IDENTITY_EVENT_TYPES.sessionEnded,
      );
    }
  });

  it('rejects suspending a pending user', async () => {
    const { service } = makeService();
    const registered = await service.register(registerInput(), context);
    if (!registered.ok) {
      throw new Error('setup failed');
    }
    const result = await service.suspend(registered.value.user.id, 'premature', context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(UserStateTransitionError);
    }
  });

  it('returns UserNotFoundError for an unknown user', async () => {
    const { service } = makeService();
    const result = await service.activate('usr_missing' as never, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(UserNotFoundError);
    }
  });

  it('assigns a role that exists', async () => {
    const { service, roles } = makeService();
    roles.save(Role.create({ name: 'workspace.admin', level: 'workspace' }));
    const user = await registerActive(service);
    const result = await service.assignRole(user.id, 'workspace.admin', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.hasRole('workspace.admin')).toBe(true);
      expect(result.value.events.map((event) => event.type)).toContain(
        IDENTITY_EVENT_TYPES.roleAssigned,
      );
    }
  });

  it('rejects assigning a role that does not exist', async () => {
    const { service } = makeService();
    const user = await registerActive(service);
    const result = await service.assignRole(user.id, 'ghost.role', context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(RoleNotFoundError);
    }
  });

  it('removes an assigned role', async () => {
    const { service, roles } = makeService();
    roles.save(Role.create({ name: 'workspace.admin', level: 'workspace' }));
    const user = await registerActive(service);
    await service.assignRole(user.id, 'workspace.admin', context);
    const result = await service.removeRole(user.id, 'workspace.admin', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.hasRole('workspace.admin')).toBe(false);
      expect(result.value.events.map((event) => event.type)).toContain(
        IDENTITY_EVENT_TYPES.roleRemoved,
      );
    }
  });

  it('updates the profile', async () => {
    const { service } = makeService();
    const user = await registerActive(service);
    const result = await service.updateProfile(user.id, { displayName: 'Alice B.' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.profile.displayName.value).toBe('Alice B.');
    }
  });

  it('changes the password with the correct current password', async () => {
    const { service } = makeService();
    const user = await registerActive(service);
    const result = await service.changePassword(user.id, 'CorrectHorse1', 'NewCorrectHorse2');
    expect(result.ok).toBe(true);
  });

  it('rejects a password change with a wrong current password as an auth failure', async () => {
    const { service } = makeService();
    const user = await registerActive(service);
    const result = await service.changePassword(user.id, 'WrongPassword1', 'NewCorrectHorse2');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidCredentialsError);
    }
  });

  it('rejects a weak new password', async () => {
    const { service } = makeService();
    const user = await registerActive(service);
    const result = await service.changePassword(user.id, 'CorrectHorse1', 'weak');
    expect(result.ok).toBe(false);
  });

  it('finds a user by id', async () => {
    const { service } = makeService();
    const user = await registerActive(service);
    const result = await service.findById(user.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(user.id);
    }
  });

  it('returns UserNotFoundError when finding a missing user', async () => {
    const { service } = makeService();
    const result = await service.findById('usr_missing' as never);
    expect(result.ok).toBe(false);
  });
});

describe('UserDomainService.deactivate with sessions', () => {
  it('ends the user active sessions on deactivation', async () => {
    const { service, users, sessions } = makeService();
    const registered = await service.register(registerInput({ status: 'active' }), context);
    if (!registered.ok) {
      throw new Error('setup failed');
    }
    const user = registered.value.user;

    // Start a session directly against the aggregate (session service tested elsewhere).
    const { Session } = await import('../src/entities/session.js');
    const session = Session.start(
      {
        userId: user.id,
        tenantId: TENANT,
        token: 'token-1',
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T08:00:00.000Z',
      },
      context,
    );
    await sessions.save(session);

    const result = await service.deactivate(user.id, 'offboarding', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const events = result.value.events;
      expect(events.map((event) => event.type)).toContain(IDENTITY_EVENT_TYPES.userDeactivated);
      expect(events.map((event) => event.type)).toContain(IDENTITY_EVENT_TYPES.sessionEnded);
      expect(await sessions.findActiveByUser(user.id)).toHaveLength(0);
      expect((await users.findById(user.id))?.status.value).toBe('deactivated');
    }
  });
});

describe('UserDomainService status helper', () => {
  it('exposes UserStatus for callers', () => {
    expect(UserStatus.active().value).toBe('active');
  });
});
