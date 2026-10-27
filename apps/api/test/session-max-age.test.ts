/**
 * AUTH-005 — `SESSION_MAX_AGE_SECONDS` is enforced by the SERVER, not just the
 * browser cookie.
 *
 * Before: the value set only the cookie's max-age; the session domain service
 * was built with the policy default (8 h), so a session stayed server-valid for
 * 8 h however short the operator configured it (a copied or retained cookie
 * kept working after the browser had dropped it). Now one lifetime sets the
 * cookie max-age AND the session policy that drives session start, validation,
 * the live-session count (AUTH-001) and `isLive` (AUTH-002).
 *
 * Clock: only `Date` is faked (no sleeping).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { hashSessionToken } from '@nexora/domain-identity';
import { loadConfig } from '../src/config.js';
import { buildContainer } from '../src/container.js';
import { buildTestApp, cookieValue } from './helpers.js';

const T0 = Date.parse('2026-09-01T09:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

afterEach(() => {
  vi.useRealTimers();
});

const at = (offsetMs: number): void => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0 + offsetMs);
};

async function loginDance(app: FastifyInstance) {
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

const sessionCookie = (response: { headers: Record<string, unknown> }): string => {
  const raw = ([] as string[]).concat(response.headers['set-cookie'] as string | string[]);
  return raw.find((c) => c.startsWith('nexora_session=')) as string;
};
const maxAgeOf = (setCookie: string): number =>
  Number(/Max-Age=(\d+)/i.exec(setCookie)?.[1] ?? Number.NaN);
const me = (app: FastifyInstance, cookie: string) =>
  app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { cookie: cookie.split(';')[0] as string },
  });

async function appWith(maxAge?: number) {
  at(0);
  return buildTestApp(
    maxAge === undefined ? {} : { env: { SESSION_MAX_AGE_SECONDS: String(maxAge) } },
  );
}

describe('AUTH-005 — configured session lifetime is enforced server-side (HTTP)', () => {
  it('SESSION_MAX_AGE_SECONDS=3600: valid inside the hour, rejected after it; cookie max-age and server expiry agree', async () => {
    const { app, repos } = await appWith(3600);
    const response = await loginDance(app);
    expect(response.statusCode).toBe(302);
    const cookie = sessionCookie(response);
    // The cookie says 3600 s…
    expect(maxAgeOf(cookie)).toBe(3600);
    // …and so does the stored server-side session.
    const stored = await repos.sessions.findByTokenHash(
      hashSessionToken(cookie.split(';')[0]!.split('=')[1]!),
    );
    expect(Date.parse(stored!.expiresAt) - Date.parse(stored!.issuedAt)).toBe(3600 * 1000);

    // Valid up to the limit (kept idle-live by use every 20 min).
    for (const minutes of [20, 40, 59]) {
      at(minutes * MINUTE);
      expect((await me(app, cookie)).statusCode).toBe(200);
    }
    // The configured lifetime passes: the SERVER rejects the same cookie,
    // although the default policy (8 h) would still have accepted it.
    at(3600 * 1000 + 1_000);
    expect((await me(app, cookie)).statusCode).toBe(401);
  });

  it('the absolute lifetime is not extended by activity (use does not move expiresAt)', async () => {
    const { app } = await appWith(3600);
    const cookie = sessionCookie(await loginDance(app));
    for (let m = 10; m < 60; m += 10) {
      at(m * MINUTE);
      expect((await me(app, cookie)).statusCode).toBe(200);
    }
    at(61 * MINUTE);
    expect((await me(app, cookie)).statusCode).toBe(401);
  });

  it('idle expiry still works independently of the configured lifetime', async () => {
    const { app } = await appWith(2 * 3600); // absolute: 2 h
    const cookie = sessionCookie(await loginDance(app));
    at(31 * MINUTE); // never used again: idle-expired long before the 2 h absolute limit
    expect((await me(app, cookie)).statusCode).toBe(401);
  });

  it('default configuration is unchanged: cookie 28800 s, session valid for 8 h and rejected after', async () => {
    const { app, repos } = await appWith();
    const cookie = sessionCookie(await loginDance(app));
    expect(maxAgeOf(cookie)).toBe(28_800);
    const stored = await repos.sessions.findByTokenHash(
      hashSessionToken(cookie.split(';')[0]!.split('=')[1]!),
    );
    expect(Date.parse(stored!.expiresAt) - Date.parse(stored!.issuedAt)).toBe(8 * HOUR);
    for (let m = 25; m < 8 * 60; m += 25) {
      at(m * MINUTE);
      expect((await me(app, cookie)).statusCode).toBe(200);
    }
    at(8 * HOUR + 1_000);
    expect((await me(app, cookie)).statusCode).toBe(401);
  });

  it('AUTH-001 with the configured policy: sessions past the CONFIGURED lifetime (but not the 8 h default, nor idle) free their slots', async () => {
    const { app } = await appWith(1200); // 20 min absolute, shorter than the 30 min idle timeout
    for (let index = 0; index < 10; index += 1) {
      expect((await loginDance(app)).statusCode).toBe(302);
    }
    at(5 * MINUTE);
    expect((await loginDance(app)).statusCode).toBe(422); // all ten still live
    at(21 * MINUTE); // past 20 min; inside idle (30 min) and inside the old 8 h default
    expect((await loginDance(app)).statusCode).toBe(302);
  });
});

describe('AUTH-005 — one lifetime for the cookie and the session policy (container)', () => {
  const env = (maxAge: string) =>
    ({
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      LOG_LEVEL: 'error',
      INTEGRATIONS_INBOUND_SECRET: 'test-inbound-secret',
      SESSION_MAX_AGE_SECONDS: maxAge,
    }) as NodeJS.ProcessEnv;

  it('AUTH-002: isLive uses the configured lifetime', async () => {
    at(0);
    const { app, repos } = await appWith(3600);
    const cookie = sessionCookie(await loginDance(app));
    const stored = await repos.sessions.findByTokenHash(
      hashSessionToken(cookie.split(';')[0]!.split('=')[1]!),
    );
    const container = buildContainer({
      config: loadConfig(env('3600')),
      repositories: repos,
      publisher: { publish: async () => undefined },
    });
    for (const minutes of [20, 40, 59]) {
      at(minutes * MINUTE);
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: cookie.split(';')[0]! },
      });
      expect(await container.sessionsService.isLive(stored!.id)).toBe(true);
    }
    at(3600 * 1000 + 1_000);
    expect(await container.sessionsService.isLive(stored!.id)).toBe(false);
  });

  it('configuration semantics: seconds, default 28800, rejects zero / negative / fractional / non-numeric / out-of-range', () => {
    expect(loadConfig(env('3600')).cookie.maxAgeSeconds).toBe(3600);
    expect(
      loadConfig({ ...env('1'), SESSION_MAX_AGE_SECONDS: undefined } as NodeJS.ProcessEnv).cookie
        .maxAgeSeconds,
    ).toBe(28_800);
    for (const bad of ['0', '-1', '1.5', 'abc', '', '8000000000001']) {
      expect(() => loadConfig(env(bad)), `value ${JSON.stringify(bad)}`).toThrow(
        /SESSION_MAX_AGE_SECONDS/,
      );
    }
    // The largest accepted value still produces a valid expiry timestamp.
    expect(() => new Date(Date.now() + 8_000_000_000_000 * 1_000).toISOString()).not.toThrow();
  });
});
