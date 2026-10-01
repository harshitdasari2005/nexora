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

  it('an explicit COOKIE_SECURE always wins (the .env.example dev value, or a hardened dev setup)', () => {
    expect(config({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }).cookie.secure).toBe(false);
    expect(config({ COOKIE_SECURE: 'true' }).cookie.secure).toBe(true);
    expect(config({ COOKIE_SECURE: 'false' }).cookie.secure).toBe(false);
  });
});
