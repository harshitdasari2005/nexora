/**
 * SessionDomainService tests: authentication, session start, validation,
 * end, and revocation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
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
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_SESSION_TTL_MS,
  SessionPolicy,
} from '../src/policies/index.js';
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

async function makeEnvironment(
  options: { maxConcurrentSessions?: number; ttlMs?: number; idleTimeoutMs?: number } = {},
): Promise<{
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

describe('SessionDomainService — the concurrency limit counts only LIVE sessions (AUTH-001)', () => {
  const T0 = Date.parse('2026-09-01T09:00:00.000Z');
  afterEach(() => {
    vi.useRealTimers();
  });
  const at = (offsetMs: number): void => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + offsetMs);
  };
  async function openSessions(sessions: SessionDomainService, count: number): Promise<string[]> {
    const tokens: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const started = await sessions.start(startInput(), context);
      if (!started.ok) throw new Error(`setup failed at ${index}: ${started.error.message}`);
      tokens.push(started.value.session.token);
    }
    return tokens;
  }

  it('genuinely live sessions still hold their slots: the 11th login is refused', async () => {
    at(0);
    const { sessions } = await makeEnvironment(); // default limit: 10
    await openSessions(sessions, 10);
    at(60_000); // one minute later: all ten are live
    const result = await sessions.start(startInput(), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(SessionLimitExceededError);
  });

  it('REPRODUCTION: ten abandoned sessions past the absolute TTL no longer block the 11th login', async () => {
    at(0);
    const { sessions, sessionRepo, userId } = await makeEnvironment();
    const tokens = await openSessions(sessions, 10);
    // Keep every session idle-live by touching it, so ONLY the absolute lifetime has passed.
    for (let minute = 25; minute < DEFAULT_SESSION_TTL_MS / 60_000; minute += 25) {
      at(minute * 60_000);
      for (const token of tokens) await sessions.validate(token);
    }
    at(DEFAULT_SESSION_TTL_MS + 1_000);
    const result = await sessions.start(startInput(), context);
    expect(result.ok).toBe(true);
    // Nothing was silently deleted or rewritten: the abandoned rows are untouched.
    const abandoned = [...sessionRepo.sessions.values()].filter((row) =>
      tokens.includes(row.token),
    );
    expect(abandoned).toHaveLength(10);
    expect(abandoned.every((row) => row.status.isActive())).toBe(true);
    expect(await sessionRepo.findActiveByUser(userId as never)).toHaveLength(11);
  });

  it('ten sessions that are only IDLE-expired (inside the absolute TTL) do not block the 11th login', async () => {
    at(0);
    const { sessions } = await makeEnvironment();
    await openSessions(sessions, 10);
    at(DEFAULT_IDLE_TIMEOUT_MS + 1_000); // 30 min + 1 s: idle-expired, well inside the 8 h TTL
    expect(DEFAULT_IDLE_TIMEOUT_MS + 1_000).toBeLessThan(DEFAULT_SESSION_TTL_MS);
    expect((await sessions.start(startInput(), context)).ok).toBe(true);
  });

  it('only live sessions count when live and expired sessions are mixed', async () => {
    at(0);
    const { sessions } = await makeEnvironment({ maxConcurrentSessions: 3 });
    const tokens = await openSessions(sessions, 3);
    // One session is used again before it idles out (touch → stays live); the other two idle out.
    at(20 * 60_000);
    expect((await sessions.validate(tokens[0] as string)).ok).toBe(true);
    at(DEFAULT_IDLE_TIMEOUT_MS + 60_000); // 31 min: the two untouched ones are idle-expired
    // 1 live + 2 stale: two new logins fit, the third (a 4th live) does not.
    expect((await sessions.start(startInput(), context)).ok).toBe(true);
    expect((await sessions.start(startInput(), context)).ok).toBe(true);
    const refused = await sessions.start(startInput(), context);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBeInstanceOf(SessionLimitExceededError);
  });

  it('absolute expiry uses the same boundary as validation (exclusive: at expiresAt the slot is free)', async () => {
    const DAY = 24 * 60 * 60 * 1_000;
    at(0);
    const { sessions } = await makeEnvironment({
      maxConcurrentSessions: 1,
      ttlMs: 1_000,
      idleTimeoutMs: DAY,
    });
    const [token] = await openSessions(sessions, 1);
    at(999);
    expect((await sessions.start(startInput(), context)).ok).toBe(false); // still live
    at(1_000); // now >= expiresAt → validation rejects, so it holds no slot
    expect((await sessions.start(startInput(), context)).ok).toBe(true);
    const stale = await sessions.validate(token as string);
    expect(stale.ok).toBe(false);
  });

  it('idle expiry uses the same boundary as validation (inclusive: at exactly the idle timeout the session is still live)', async () => {
    const DAY = 24 * 60 * 60 * 1_000;
    at(0);
    const held = await makeEnvironment({
      maxConcurrentSessions: 1,
      ttlMs: DAY,
      idleTimeoutMs: 1_000,
    });
    const [token] = await openSessions(held.sessions, 1);
    at(1_000); // now - lastUsed == idle: NOT idle-expired → still holds the slot
    expect((await held.sessions.start(startInput(), context)).ok).toBe(false);
    expect((await held.sessions.validate(token as string)).ok).toBe(true);

    at(0);
    const freed = await makeEnvironment({
      maxConcurrentSessions: 1,
      ttlMs: DAY,
      idleTimeoutMs: 1_000,
    });
    const [idleToken] = await openSessions(freed.sessions, 1);
    at(1_001); // one ms past idle → validation rejects, so the slot is free
    expect((await freed.sessions.start(startInput(), context)).ok).toBe(true);
    const stale = await freed.sessions.validate(idleToken as string);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toBeInstanceOf(SessionExpiredError);
  });

  it('validation of an expired token is unchanged (still rejected, then marked expired)', async () => {
    at(0);
    const { sessions } = await makeEnvironment();
    const [token] = await openSessions(sessions, 1);
    at(DEFAULT_SESSION_TTL_MS + 1_000);
    const result = await sessions.validate(token as string);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(SessionExpiredError);
  });

  it('startVerified (the OIDC path) applies the same liveness rule', async () => {
    at(0);
    const { sessions, userId } = await makeEnvironment({ maxConcurrentSessions: 2 });
    const verified = () =>
      sessions.startVerified({ userId: userId as never, tenantId: TENANT }, context);
    expect((await verified()).ok).toBe(true);
    expect((await verified()).ok).toBe(true);
    const refused = await verified();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBeInstanceOf(SessionLimitExceededError);
    at(DEFAULT_IDLE_TIMEOUT_MS + 1_000);
    expect((await verified()).ok).toBe(true);
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

describe('SessionDomainService.isLive (AUTH-002 — read-only liveness for long-lived connections)', () => {
  const T0 = Date.parse('2026-09-01T09:00:00.000Z');
  afterEach(() => {
    vi.useRealTimers();
  });
  const at = (offsetMs: number): void => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + offsetMs);
  };

  it('is true for a live session and false for an unknown id', async () => {
    at(0);
    const { sessions } = await makeEnvironment();
    const started = await sessions.start(startInput(), context);
    if (!started.ok) throw new Error('setup failed');
    expect(await sessions.isLive(started.value.session.id)).toBe(true);
    expect(await sessions.isLive('ses_unknown')).toBe(false);
  });

  it('is false once the session is ended, revoked, past its absolute expiry, or idle-expired', async () => {
    at(0);
    const { sessions, sessionRepo } = await makeEnvironment();
    const open = async () => {
      const started = await sessions.start(startInput(), context);
      if (!started.ok) throw new Error('setup failed');
      return started.value.session;
    };
    const ended = await open();
    const revoked = await open();
    const idle = await open();
    await sessions.end(ended.id, context);
    await sessions.revoke(revoked.id, 'test', context);
    expect(await sessions.isLive(ended.id)).toBe(false);
    expect(await sessions.isLive(revoked.id)).toBe(false);
    expect(await sessions.isLive(idle.id)).toBe(true);
    at(DEFAULT_IDLE_TIMEOUT_MS + 1_000);
    expect(await sessions.isLive(idle.id)).toBe(false); // idle-expired
    // Absolute expiry (kept idle-live by touching first).
    at(0);
    const longLived = await open();
    for (let m = 25; m < DEFAULT_SESSION_TTL_MS / 60_000; m += 25) {
      at(m * 60_000);
      await sessions.validate(longLived.token);
    }
    at(DEFAULT_SESSION_TTL_MS + 1_000);
    expect(await sessions.isLive(longLived.id)).toBe(false);
    expect(sessionRepo.sessions.size).toBeGreaterThan(0);
  });

  it('NEVER touches or rewrites the session (a re-checking connection cannot keep an idle session alive)', async () => {
    at(0);
    const { sessions, sessionRepo } = await makeEnvironment();
    const started = await sessions.start(startInput(), context);
    if (!started.ok) throw new Error('setup failed');
    const id = started.value.session.id;
    const lastUsed = (await sessionRepo.findById(id))?.lastUsedAt;
    at(20 * 60_000);
    expect(await sessions.isLive(id)).toBe(true);
    expect((await sessionRepo.findById(id))?.lastUsedAt).toBe(lastUsed);
    at(DEFAULT_IDLE_TIMEOUT_MS + 1_000);
    expect(await sessions.isLive(id)).toBe(false); // still idles out despite the earlier checks
    // And an idle-expired session is not rewritten to `expired` by a mere check.
    expect((await sessionRepo.findById(id))?.status.isActive()).toBe(true);
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
