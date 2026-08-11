/**
 * SessionDomainService tests: authentication, session start, validation,
 * end, and revocation.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import { IDENTITY_EVENT_TYPES } from '../src/events/index.js';
import {
  InvalidCredentialsError,
  SessionExpiredError,
  SessionLimitExceededError,
  SessionNotFoundError,
  SessionRevokedError,
  SessionTenantMismatchError,
} from '../src/errors/index.js';
import { SessionDomainService, UserDomainService } from '../src/services/index.js';
import { SessionPolicy } from '../src/policies/index.js';
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

async function makeEnvironment(options: { maxConcurrentSessions?: number } = {}): Promise<{
  sessions: SessionDomainService;
  users: InMemoryUserRepository;
  sessionRepo: InMemorySessionRepository;
  userId: string;
}> {
  const users = new InMemoryUserRepository();
  const sessionRepo = new InMemorySessionRepository();
  const roles = new InMemoryRoleRepository();
  const hasher = new TestPasswordHasher();

  const userService = new UserDomainService({ users, roles, sessions: sessionRepo, hasher });
  const registered = await userService.register(
    {
      tenantId: TENANT,
      email: 'alice@example.com',
      username: 'alice',
      password: 'CorrectHorse1',
      displayName: 'Alice',
      status: 'active',
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
    policy: new SessionPolicy(options),
  });
  return { sessions, users, sessionRepo, userId: registered.value.user.id };
}

function startInput(overrides: Partial<Parameters<SessionDomainService['start']>[0]> = {}) {
  return {
    tenantId: TENANT,
    identifier: 'alice@example.com',
    password: 'CorrectHorse1',
    ...overrides,
  };
}

describe('SessionDomainService.start', () => {
  it('starts a session for valid credentials and emits SessionStarted', async () => {
    const { sessions, sessionRepo } = await makeEnvironment();
    const result = await sessions.start(startInput(), context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.session.token).toBeTruthy();
      expect(result.value.session.userId).toBeTruthy();
      expect(result.value.events.map((event) => event.type)).toContain(
        IDENTITY_EVENT_TYPES.sessionStarted,
      );
      expect(sessionRepo.sessions.size).toBe(1);
    }
  });

  it('authenticates by username', async () => {
    const { sessions } = await makeEnvironment();
    const result = await sessions.start(startInput({ identifier: 'alice' }), context);
    expect(result.ok).toBe(true);
  });

  it('rejects a session for a tenant the user does not belong to', async () => {
    const { sessions } = await makeEnvironment();
    const result = await sessions.start(
      startInput({ tenantId: 'tenant_other' as TenantId }),
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SessionTenantMismatchError);
    }
  });

  it('rejects a wrong password with InvalidCredentialsError', async () => {
    const { sessions } = await makeEnvironment();
    const result = await sessions.start(startInput({ password: 'WrongPass1' }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidCredentialsError);
    }
  });

  it('rejects an unknown user with InvalidCredentialsError (no enumeration)', async () => {
    const { sessions } = await makeEnvironment();
    const result = await sessions.start(
      startInput({ identifier: 'ghost@example.com', password: 'CorrectHorse1' }),
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidCredentialsError);
    }
  });

  it('rejects a session for an inactive user as invalid credentials (no enumeration)', async () => {
    const { sessions, users, sessionRepo } = await makeEnvironment();
    const hasher = new TestPasswordHasher();
    const userService = new UserDomainService({
      users,
      roles: new InMemoryRoleRepository(),
      sessions: sessionRepo,
      hasher,
    });
    const registered = await userService.register(
      {
        tenantId: TENANT,
        email: 'bob@example.com',
        username: 'bob',
        password: 'CorrectHorse1',
        displayName: 'Bob',
        status: 'pending',
      },
      context,
    );
    if (!registered.ok) {
      throw new Error('setup failed');
    }
    const result = await sessions.start(startInput({ identifier: 'bob@example.com' }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The login boundary must not leak account status.
      expect(result.error).toBeInstanceOf(InvalidCredentialsError);
    }
  });

  it('rejects a session past the concurrency limit', async () => {
    const { sessions, sessionRepo, userId } = await makeEnvironment({
      maxConcurrentSessions: 2,
    });
    for (let index = 0; index < 2; index += 1) {
      const started = await sessions.start(startInput(), context);
      if (!started.ok) {
        throw new Error('setup failed');
      }
    }
    // force one extra active session directly
    const { Session } = await import('../src/entities/session.js');
    await sessionRepo.save(
      Session.start(
        {
          userId: userId as never,
          tenantId: TENANT,
          token: 'extra-token',
          issuedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-01T08:00:00.000Z',
        },
        context,
      ),
    );
    const result = await sessions.start(startInput(), context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SessionLimitExceededError);
    }
  });
});

describe('SessionDomainService.validate', () => {
  async function startOne(): Promise<{ token: string; sessions: SessionDomainService }> {
    const env = await makeEnvironment();
    const started = await env.sessions.start(startInput(), context);
    if (!started.ok) {
      throw new Error('setup failed');
    }
    return { token: started.value.session.token, sessions: env.sessions };
  }

  it('validates an active session', async () => {
    const { token, sessions } = await startOne();
    const result = await sessions.validate(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status.isActive()).toBe(true);
    }
  });

  it('rejects an unknown token', async () => {
    const { sessions } = await startOne();
    const result = await sessions.validate('no-such-token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SessionNotFoundError);
    }
  });

  it('rejects an expired session', async () => {
    const { sessions, sessionRepo, userId } = await makeEnvironment();
    const { Session } = await import('../src/entities/session.js');
    // A session issued and expired in the past.
    const expired = Session.start(
      {
        userId: userId as never,
        tenantId: TENANT,
        token: 'expired-token',
        issuedAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-01-02T00:00:00.000Z',
      },
      context,
    );
    await sessionRepo.save(expired);
    const result = await sessions.validate(expired.token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SessionExpiredError);
    }
  });

  it('rejects a revoked session', async () => {
    const { sessions, sessionRepo } = await makeEnvironment();
    const started = await sessions.start(startInput(), context);
    if (!started.ok) {
      throw new Error('setup failed');
    }
    const session = started.value.session;
    session.revoke(context, 'security');
    await sessionRepo.save(session);
    const result = await sessions.validate(session.token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SessionRevokedError);
    }
  });
});

describe('SessionDomainService.end / revoke / endAllForUser', () => {
  it('ends a session and emits SessionEnded', async () => {
    const { sessions } = await makeEnvironment();
    const started = await sessions.start(startInput(), context);
    if (!started.ok) {
      throw new Error('setup failed');
    }
    const session = started.value.session;
    const result = await sessions.end(session.id, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.session.status.value).toBe('ended');
      expect(result.value.events.map((event) => event.type)).toContain(
        IDENTITY_EVENT_TYPES.sessionEnded,
      );
    }
  });

  it('rejects ending an unknown session', async () => {
    const { sessions } = await makeEnvironment();
    const result = await sessions.end('ses_missing', context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SessionNotFoundError);
    }
  });

  it('revokes a session', async () => {
    const { sessions } = await makeEnvironment();
    const started = await sessions.start(startInput(), context);
    if (!started.ok) {
      throw new Error('setup failed');
    }
    const result = await sessions.revoke(started.value.session.id, 'compromised', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.session.status.value).toBe('revoked');
    }
  });

  it('ends all active sessions for a user', async () => {
    const { sessions, sessionRepo, userId } = await makeEnvironment();
    await sessions.start(startInput(), context);
    await sessions.start(startInput(), context);
    const result = await sessions.endAllForUser(userId as never, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessions.length).toBeGreaterThanOrEqual(1);
      expect(await sessionRepo.findActiveByUser(userId as never)).toHaveLength(0);
    }
  });
});

describe('SessionDomainService helper surface', () => {
  it('exposes the user status vocabulary', () => {
    expect(UserStatus.active().value).toBe('active');
  });
});
