/**
 * AUTH-001 — the per-user session concurrency limit counts only LIVE sessions.
 *
 * Abandoned sessions keep the stored status `active` until their token is next
 * presented, so counting by status alone let ten abandoned logins lock the
 * account out (422 "Session limit exceeded") long after every one of them had
 * passed its absolute (8 h) or idle (30 min) lifetime. Through the real OIDC
 * callback: live sessions still hold their slots; expired ones do not.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildTestApp, cookieValue } from './helpers.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** One full login dance; returns the callback response (the session cookie on success). */
async function loginAttempt(app: FastifyInstance) {
  const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const state = cookieValue(start, 'oidc_state')?.split('=')[1] ?? '';
  const verifier = cookieValue(start, 'oidc_verifier')?.split('=')[1] ?? '';
  const nonce = cookieValue(start, 'oidc_nonce')?.split('=')[1] ?? '';
  return app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=test-code&state=${state}`,
    headers: { cookie: `oidc_state=${state}; oidc_verifier=${verifier}; oidc_nonce=${nonce}` },
  });
}

describe('AUTH-001 — session limit and expired sessions (HTTP, real OIDC callback)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function tenLogins() {
    // Fake only Date: timers/IO keep working; session code reads `new Date()`.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-09-01T09:00:00.000Z'));
    const { app } = await buildTestApp();
    const cookies: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const response = await loginAttempt(app);
      expect(response.statusCode).toBe(302);
      cookies.push(String(cookieValue(response, 'nexora_session')?.split(';')[0]));
    }
    return { app, cookies };
  }

  it('ten live sessions still block the 11th login (the limit is intact)', async () => {
    const { app } = await tenLogins();
    vi.setSystemTime(Date.parse('2026-09-01T09:05:00.000Z'));
    const eleventh = await loginAttempt(app);
    expect(eleventh.statusCode).toBe(422);
    expect(eleventh.body).toContain('Session limit exceeded');
  });

  it('REPRODUCTION: ten abandoned sessions past the 8 h lifetime no longer lock the user out', async () => {
    const { app, cookies } = await tenLogins();
    vi.setSystemTime(Date.parse('2026-09-01T09:00:00.000Z') + 8 * HOUR + MINUTE);
    const eleventh = await loginAttempt(app);
    expect(eleventh.statusCode).toBe(302);
    const fresh = String(cookieValue(eleventh, 'nexora_session')?.split(';')[0]);
    // The new session works…
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: fresh } });
    expect(me.statusCode).toBe(200);
    // …and the abandoned ones are still rejected by session validation (unchanged).
    for (const cookie of cookies) {
      const old = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
      expect(old.statusCode).toBe(401);
    }
  });

  it('ten sessions that are only idle-expired (31 min, inside the 8 h lifetime) do not block the 11th login', async () => {
    const { app } = await tenLogins();
    vi.setSystemTime(Date.parse('2026-09-01T09:00:00.000Z') + 31 * MINUTE);
    expect((await loginAttempt(app)).statusCode).toBe(302);
  });
});
