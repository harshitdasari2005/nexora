/**
 * Session aggregate tests: start, touch, end, revoke, expire, invariants,
 * and event emission.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';

import { IDENTITY_EVENT_TYPES } from '../src/events/index.js';
import { SessionExpiredError, SessionRevokedError } from '../src/errors/index.js';
import { Session } from '../src/entities/session.js';
import { testContext } from './helpers.js';

const context = testContext();
const USER_ID = 'usr_1' as UserId;
const TENANT = 'tenant_1' as TenantId;

function startSession(expiresAt = '2026-01-01T08:00:00.000Z'): Session {
  return Session.start(
    {
      userId: USER_ID,
      tenantId: TENANT,
      token: 'token-abc',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt,
    },
    context,
  );
}

describe('Session aggregate', () => {
  it('starts active and emits SessionStarted', () => {
    const session = startSession();
    expect(session.status.isActive()).toBe(true);
    const events = session.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(IDENTITY_EVENT_TYPES.sessionStarted);
  });

  it('is active before expiry and expired after', () => {
    const session = startSession('2026-01-01T08:00:00.000Z');
    expect(session.isActive('2026-01-01T07:00:00.000Z')).toBe(true);
    expect(session.isActive('2026-01-01T09:00:00.000Z')).toBe(false);
    expect(session.isExpired('2026-01-01T09:00:00.000Z')).toBe(true);
  });

  it('touch updates lastUsedAt', () => {
    const session = startSession();
    session.touch('2026-01-01T05:00:00.000Z');
    expect(session.lastUsedAt).toBe('2026-01-01T05:00:00.000Z');
  });

  it('touch on an expired session throws SessionExpiredError and expires it', () => {
    const session = startSession();
    expect(() => session.touch('2026-01-01T09:00:00.000Z')).toThrow(SessionExpiredError);
    expect(session.status.value).toBe('expired');
    const events = session.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(IDENTITY_EVENT_TYPES.sessionEnded);
  });

  it('touch on an ended session throws SessionRevokedError', () => {
    const session = startSession();
    session.end(context);
    expect(() => session.touch('2026-01-01T01:00:00.000Z')).toThrow(SessionRevokedError);
  });

  it('ends a session and emits SessionEnded', () => {
    const session = startSession();
    const transitioned = session.end(context);
    expect(transitioned).toBe(true);
    expect(session.status.value).toBe('ended');
    const events = session.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(IDENTITY_EVENT_TYPES.sessionEnded);
  });

  it('ending an ended session is a no-op (idempotent)', () => {
    const session = startSession();
    session.end(context);
    session.pullDomainEvents();
    expect(session.end(context)).toBe(false);
    expect(session.pullDomainEvents()).toHaveLength(0);
  });

  it('revokes a session and emits SessionEnded with the reason', () => {
    const session = startSession();
    const transitioned = session.revoke(context, 'suspicious-activity');
    expect(transitioned).toBe(true);
    expect(session.status.value).toBe('revoked');
    const events = session.pullDomainEvents();
    const ended = events.find((event) => event.type === IDENTITY_EVENT_TYPES.sessionEnded);
    expect(ended?.payload).toMatchObject({ reason: 'suspicious-activity' });
  });

  it('revoking a revoked session is a no-op', () => {
    const session = startSession();
    session.revoke(context, 'first');
    session.pullDomainEvents();
    expect(session.revoke(context, 'second')).toBe(false);
  });

  it('expire transitions an active session to expired', () => {
    const session = startSession();
    expect(session.expire('2026-01-01T09:00:00.000Z')).toBe(true);
    expect(session.status.value).toBe('expired');
  });

  it('expire on an already-expired session is a no-op', () => {
    const session = startSession();
    session.expire('2026-01-01T09:00:00.000Z');
    session.pullDomainEvents();
    expect(session.expire('2026-01-01T10:00:00.000Z')).toBe(false);
  });

  it('attributes passive expiry to a system actor, not the user', () => {
    const session = startSession();
    session.expire('2026-01-01T09:00:00.000Z');
    const events = session.pullDomainEvents();
    const ended = events.find((event) => event.type === IDENTITY_EVENT_TYPES.sessionEnded);
    expect(ended).toBeDefined();
    expect(ended?.actor.kind).toBe('system');
    expect(ended?.actor.id).toMatch(/^system:/);
  });

  it('exposes owner and token', () => {
    const session = startSession();
    expect(session.userId).toBe(USER_ID);
    expect(session.token).toBe('token-abc');
    expect(session.id).toMatch(/^ses_/);
  });
});
