/**
 * AUTH-004 — the raw session bearer token is never persisted.
 *
 * The token exists in memory only at `Session.start` (to be handed to the
 * client). Persistence and lookup use its SHA-256 digest.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';

import { Session } from '../src/entities/session.js';
import { SessionNotFoundError } from '../src/errors/index.js';
import { SessionPolicy } from '../src/policies/index.js';
import { SessionDomainService } from '../src/services/index.js';
import { hashSessionToken, SESSION_TOKEN_HASH_LENGTH } from '../src/value-objects/index.js';
import {
  InMemorySessionRepository,
  InMemoryUserRepository,
  TestPasswordHasher,
  testContext,
} from './helpers.js';

const TENANT = 'tenant_1' as TenantId;
const context = testContext();

function start(token: string): Session {
  return Session.start(
    {
      userId: 'usr_1' as UserId,
      tenantId: TENANT,
      token,
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    context,
  );
}

describe('hashSessionToken', () => {
  it('is the lowercase SHA-256 hex digest (64 chars), deterministic, and not the token', () => {
    const raw = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const hash = hashSessionToken(raw);
    expect(hash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toHaveLength(SESSION_TOKEN_HASH_LENGTH);
    expect(hash).not.toBe(raw);
    expect(hashSessionToken(raw)).toBe(hash);
    expect(hashSessionToken(`${raw}x`)).not.toBe(hash);
  });
});

describe('Session — the raw token never reaches a snapshot', () => {
  it('a started session exposes the raw token once; its snapshot carries only the digest', () => {
    const raw = 'raw-bearer-token-abc-123';
    const session = start(raw);
    expect(session.token).toBe(raw);
    const snapshot = Session.snapshot(session);
    expect(snapshot.tokenHash).toBe(hashSessionToken(raw));
    expect(snapshot).not.toHaveProperty('token');
    expect(JSON.stringify(snapshot)).not.toContain(raw);
  });

  it('a rehydrated session has no raw token to leak', () => {
    const session = start('raw-bearer-token-xyz');
    const hydrated = Session.hydrate(Session.snapshot(session));
    expect(hydrated.tokenHash).toBe(session.tokenHash);
    expect(() => hydrated.token).toThrow(/only available on a newly started session/);
  });

  it('the start event does not carry the token', () => {
    const raw = 'raw-bearer-token-event';
    const session = start(raw);
    expect(JSON.stringify(session.pullDomainEvents())).not.toContain(raw);
  });
});

describe('SessionDomainService.validate — hashed lookup', () => {
  async function setup() {
    const sessionRepo = new InMemorySessionRepository();
    const users = new InMemoryUserRepository();
    const sessions = new SessionDomainService({
      sessions: sessionRepo,
      users,
      hasher: new TestPasswordHasher(),
      policy: new SessionPolicy(),
    });
    const session = start('the-cookie-token-0123456789');
    await sessionRepo.save(session);
    return { sessions, sessionRepo, session };
  }

  it('authenticates with the raw token', async () => {
    const { sessions, session } = await setup();
    expect((await sessions.validate(session.token)).ok).toBe(true);
  });

  it('rejects a token that differs by one character, and the stored digest used as a cookie', async () => {
    const { sessions, session } = await setup();
    const flipped = `${session.token.slice(0, -1)}${session.token.endsWith('0') ? '1' : '0'}`;
    for (const presented of [flipped, session.token.toUpperCase(), session.tokenHash, '']) {
      const result = await sessions.validate(presented);
      expect(result.ok, presented).toBe(false);
      if (!result.ok) expect(result.error).toBeInstanceOf(SessionNotFoundError);
    }
  });

  it('an unknown token error never echoes the presented credential', async () => {
    const { sessions } = await setup();
    const result = await sessions.validate('presented-secret-credential-987');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result.error)).not.toContain('presented-secret-credential-987');
      expect(result.error.message).not.toContain('presented-secret-credential-987');
    }
  });

  it('ending a session by id still invalidates its token', async () => {
    const { sessions, session } = await setup();
    await sessions.end(session.id, context);
    expect((await sessions.validate(session.token)).ok).toBe(false);
  });
});
