/**
 * SessionDomainService.startVerified tests: the OIDC session path for an
 * already-verified principal (Keycloak authenticates; this service issues
 * the session). Covers eligibility, session limit, and event emission.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';

import { IDENTITY_EVENT_TYPES } from '../src/events/index.js';
import {
  SessionLimitExceededError,
  SessionTenantMismatchError,
  UserNotActiveError,
  UserNotFoundError,
} from '../src/errors/index.js';
import { SessionDomainService, UserDomainService } from '../src/services/index.js';
import { SessionPolicy } from '../src/policies/index.js';
import {
  InMemoryRoleRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  TestPasswordHasher,
  testContext,
} from './helpers.js';

const TENANT = 'tenant_1' as TenantId;
const context = testContext();

interface Environment {
  sessions: SessionDomainService;
  users: InMemoryUserRepository;
  sessionRepo: InMemorySessionRepository;
  userId: UserId;
}

/** Registers a user (status defaults to `active` unless overridden). */
async function makeEnvironment(
  options: {
    status?: string;
    maxConcurrentSessions?: number;
    email?: string;
    username?: string;
  } = {},
): Promise<Environment> {
  const users = new InMemoryUserRepository();
  const sessionRepo = new InMemorySessionRepository();
  const roles = new InMemoryRoleRepository();
  const hasher = new TestPasswordHasher();

  const userService = new UserDomainService({ users, roles, sessions: sessionRepo, hasher });
  const registered = await userService.register(
    {
      tenantId: TENANT,
      email: options.email ?? 'alice@example.com',
      username: options.username ?? 'alice',
      password: 'CorrectHorse1',
      displayName: 'Alice',
      status: options.status ?? 'active',
    },
    context,
  );
  if (!registered.ok) {
    throw new Error('setup failed');
  }

  const sessions = new SessionDomainService({
    sessions: sessionRepo,
    users,
    hasher,
    policy: new SessionPolicy({ maxConcurrentSessions: options.maxConcurrentSessions }),
  });
  return { sessions, users, sessionRepo, userId: registered.value.user.id };
}

describe('SessionDomainService.startVerified', () => {
  it('starts a session for a verified active principal and emits SessionStarted', async () => {
    const { sessions, sessionRepo, userId } = await makeEnvironment();
    const result = await sessions.startVerified({ userId, tenantId: TENANT }, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.session.userId).toBe(userId);
      expect(result.value.session.status.isActive()).toBe(true);
      expect(result.value.session.token).toBeTruthy();
      expect(result.value.events.map((event) => event.type)).toContain(
        IDENTITY_EVENT_TYPES.sessionStarted,
      );
      expect(sessionRepo.sessions.size).toBe(1);
    }
  });

  it('does not verify a password: authentication is delegated to the IdP', async () => {
    // The command surface takes only userId + tenantId — there is no password
    // to verify. This test documents that contract at the type level.
    const { sessions, userId } = await makeEnvironment();
    const result = await sessions.startVerified({ userId, tenantId: TENANT }, context);
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown user with UserNotFoundError', async () => {
    const { sessions } = await makeEnvironment();
    const result = await sessions.startVerified(
      { userId: 'usr_missing' as UserId, tenantId: TENANT },
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(UserNotFoundError);
    }
  });

  it('rejects a session for a tenant the user does not belong to', async () => {
    const { sessions, userId } = await makeEnvironment();
    const result = await sessions.startVerified(
      { userId, tenantId: 'tenant_other' as TenantId },
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SessionTenantMismatchError);
    }
  });

  it('rejects a pending user with UserNotActiveError', async () => {
    const { sessions, userId } = await makeEnvironment({ status: 'pending' });
    const result = await sessions.startVerified({ userId, tenantId: TENANT }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(UserNotActiveError);
    }
  });

  it('rejects a deactivated user with UserNotActiveError', async () => {
    const { sessions, users, userId } = await makeEnvironment();
    const user = users.users.get(userId);
    if (user === undefined) {
      throw new Error('setup failed');
    }
    user.deactivate('offboarding', context);
    const result = await sessions.startVerified({ userId, tenantId: TENANT }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(UserNotActiveError);
    }
  });

  it('enforces the concurrent-session limit', async () => {
    const { sessions, userId } = await makeEnvironment({ maxConcurrentSessions: 1 });
    const first = await sessions.startVerified({ userId, tenantId: TENANT }, context);
    expect(first.ok).toBe(true);
    const second = await sessions.startVerified({ userId, tenantId: TENANT }, context);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBeInstanceOf(SessionLimitExceededError);
    }
  });

  it('issues sessions with an expiry derived from the session policy', async () => {
    const { sessions, userId } = await makeEnvironment();
    const result = await sessions.startVerified({ userId, tenantId: TENANT }, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issued = Date.parse(result.value.session.issuedAt);
      const expires = Date.parse(result.value.session.expiresAt);
      expect(expires - issued).toBe(8 * 60 * 60 * 1_000);
    }
  });
});
