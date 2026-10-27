/**
 * Tenant-isolation audit DID-8 — production safety of the API configuration.
 *
 * - Demo mode exposes an unauthenticated persona sign-in: with
 *   NODE_ENV=production it must not start from a lone NEXORA_DEMO_MODE=true.
 * - The session cookie is `Secure` by default in production.
 * Local development, tests and CI (no NODE_ENV=production) are unchanged.
 */

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const BASE = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  INTEGRATIONS_INBOUND_SECRET: 'test-inbound-secret',
};
const config = (extra: Record<string, string>) => loadConfig({ ...BASE, ...extra });

describe('demo mode in production', () => {
  it('refuses to start with NEXORA_DEMO_MODE=true under NODE_ENV=production', () => {
    expect(() => config({ NODE_ENV: 'production', NEXORA_DEMO_MODE: 'true' })).toThrow(
      /Refusing to start.*NEXORA_DEMO_MODE=true.*NODE_ENV=production/s,
    );
  });

  it('a lone acknowledgement flag does not enable demo mode by itself', () => {
    const c = config({ NODE_ENV: 'production', NEXORA_DEMO_ALLOW_IN_PRODUCTION: 'true' });
    expect(c.demo?.enabled).toBe(false);
  });

  it('only the explicit double opt-in allows a deliberately public demo deployment', () => {
    const c = config({
      NODE_ENV: 'production',
      NEXORA_DEMO_MODE: 'true',
      NEXORA_DEMO_ALLOW_IN_PRODUCTION: 'true',
    });
    expect(c.demo?.enabled).toBe(true);
  });

  it('is unchanged outside production: local dev / tests / CI can enable demo mode', () => {
    expect(config({ NEXORA_DEMO_MODE: 'true' }).demo?.enabled).toBe(true);
    expect(config({ NODE_ENV: 'development', NEXORA_DEMO_MODE: 'true' }).demo?.enabled).toBe(true);
    expect(config({ NODE_ENV: 'test', NEXORA_DEMO_MODE: 'true' }).demo?.enabled).toBe(true);
  });

  it('production without demo mode starts normally, and demo stays off by default', () => {
    expect(config({ NODE_ENV: 'production' }).demo?.enabled).toBe(false);
    expect(config({}).demo?.enabled).toBe(false);
  });

  it('only the literal "true" enables demo mode (no truthy-string accident)', () => {
    for (const value of ['1', 'TRUE', 'yes', ' true']) {
      expect(config({ NODE_ENV: 'production', NEXORA_DEMO_MODE: value }).demo?.enabled).toBe(false);
    }
  });
});

describe('session cookie Secure flag', () => {
  it('defaults to Secure in production', () => {
    expect(config({ NODE_ENV: 'production' }).cookie.secure).toBe(true);
  });

  it('keeps the existing default outside production (HTTP local dev works)', () => {
    expect(config({}).cookie.secure).toBe(false);
    expect(config({ NODE_ENV: 'development' }).cookie.secure).toBe(false);
  });

  it('outside production an explicit COOKIE_SECURE wins (the .env.example dev value, or a hardened dev setup)', () => {
    expect(config({ COOKIE_SECURE: 'true' }).cookie.secure).toBe(true);
    expect(config({ COOKIE_SECURE: 'false' }).cookie.secure).toBe(false);
  });

  it('AUTH-003: COOKIE_SECURE=false on a production deployment is refused unless explicitly acknowledged', () => {
    expect(() => config({ NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(
      /Refusing to start.*COOKIE_SECURE=false/s,
    );
    // The deliberate, acknowledged exception (an HTTP-only non-loopback environment).
    const acknowledged = config({
      NODE_ENV: 'production',
      COOKIE_SECURE: 'false',
      NEXORA_ALLOW_INSECURE_COOKIES: 'true',
    });
    expect(acknowledged.cookie.secure).toBe(false);
    // An explicit COOKIE_SECURE=true on production is simply honoured.
    expect(config({ NODE_ENV: 'production', COOKIE_SECURE: 'true' }).cookie.secure).toBe(true);
  });
});

describe('AUTH-003 — a missing NODE_ENV cannot silently disable the production controls', () => {
  // A deployment reachable at a non-loopback origin is production-like even if
  // NODE_ENV was never set (the failure mode: a forgotten or misspelled variable).
  const PUBLIC = {
    WEB_ORIGIN: 'https://app.example.com',
    OIDC_REDIRECT_URI: 'https://app.example.com/api/auth/callback',
  };

  it('Secure cookies default on, with NO NODE_ENV, for a public origin', () => {
    expect(config(PUBLIC).cookie.secure).toBe(true);
    expect(config({ ...PUBLIC, NODE_ENV: 'prod' }).cookie.secure).toBe(true); // misspelled
    expect(config({ WEB_ORIGIN: 'https://app.example.com' }).cookie.secure).toBe(true);
    expect(config({ OIDC_REDIRECT_URI: 'https://api.example.com/cb' }).cookie.secure).toBe(true);
  });

  it('demo mode stays protected on a public origin without NODE_ENV', () => {
    expect(() => config({ ...PUBLIC, NEXORA_DEMO_MODE: 'true' })).toThrow(
      /Refusing to start.*NEXORA_DEMO_MODE=true/s,
    );
    expect(
      config({ ...PUBLIC, NEXORA_DEMO_MODE: 'true', NEXORA_DEMO_ALLOW_IN_PRODUCTION: 'true' }).demo
        ?.enabled,
    ).toBe(true);
  });

  it('insecure cookies on a public origin without NODE_ENV need the acknowledgement', () => {
    expect(() => config({ ...PUBLIC, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE=false/);
    expect(
      config({ ...PUBLIC, COOKIE_SECURE: 'false', NEXORA_ALLOW_INSECURE_COOKIES: 'true' }).cookie
        .secure,
    ).toBe(false);
  });

  it('loopback origins (local HTTP dev, tests, CI) keep the existing behavior', () => {
    for (const origin of [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://[::1]:5173',
      'http://app.localhost:5173',
    ]) {
      const c = config({ WEB_ORIGIN: origin, COOKIE_SECURE: 'false', NEXORA_DEMO_MODE: 'true' });
      expect(c.cookie.secure, origin).toBe(false);
      expect(c.demo?.enabled, origin).toBe(true);
    }
    // The shipped defaults (no WEB_ORIGIN at all) are loopback.
    expect(config({}).cookie.secure).toBe(false);
  });

  it('an unparseable origin is treated as non-loopback (fails toward the safe posture)', () => {
    expect(config({ WEB_ORIGIN: 'not a url' }).cookie.secure).toBe(true);
  });
});
