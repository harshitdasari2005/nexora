/**
 * AUTH-007 — the session cookie is a `__Host-` cookie whenever it is Secure.
 *
 * `__Host-` makes browsers refuse the cookie unless it is Secure, Path=/ and has
 * NO Domain, so a sibling subdomain or an insecure channel cannot set, overwrite
 * or shadow it. Plain-HTTP loopback development cannot use the prefix (browsers
 * reject a `__Host-` cookie without Secure), so it keeps the unprefixed name —
 * explicit, tested, and never accepted in addition to the prefixed one.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { loadConfig } from '../src/config.js';
import { buildTestApp } from './helpers.js';

const BASE = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  INTEGRATIONS_INBOUND_SECRET: 'test-inbound-secret',
};
const config = (extra: Record<string, string>) =>
  loadConfig({ ...BASE, ...extra } as NodeJS.ProcessEnv);

const setCookies = (r: { headers: Record<string, unknown> }): string[] =>
  ([] as string[]).concat((r.headers['set-cookie'] as string | string[] | undefined) ?? []);

/** A full login dance; returns the emitted session Set-Cookie header. */
async function loginCookie(app: FastifyInstance, name: string): Promise<string> {
  const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const get = (n: string) =>
    setCookies(start)
      .find((c) => c.startsWith(`${n}=`))!
      .split(';')[0]!
      .split('=')[1]!;
  const state = get('oidc_state');
  const cb = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=c&state=${state}`,
    headers: {
      cookie: `oidc_state=${state}; oidc_verifier=${get('oidc_verifier')}; oidc_nonce=${get('oidc_nonce')}`,
    },
  });
  expect(cb.statusCode).toBe(302);
  const header = setCookies(cb).find((c) => c.startsWith(`${name}=`));
  expect(header, `a "${name}" session cookie`).toBeDefined();
  return header as string;
}
const pair = (setCookie: string): string => setCookie.split(';')[0] as string;

const PUBLIC = {
  WEB_ORIGIN: 'https://app.example.com',
  OIDC_REDIRECT_URI: 'https://app.example.com/api/auth/callback',
};

describe('AUTH-007 — cookie name selection (config)', () => {
  it('Secure → __Host-nexora_session; plain-HTTP loopback dev → nexora_session', () => {
    expect(config({}).cookie).toMatchObject({ name: 'nexora_session', secure: false });
    expect(config({ COOKIE_SECURE: 'true' }).cookie).toMatchObject({
      name: '__Host-nexora_session',
      secure: true,
    });
    expect(config({ NODE_ENV: 'production' }).cookie.name).toBe('__Host-nexora_session');
  });

  it('production-like detection still applies with NODE_ENV unset (public origins): Secure and __Host-', () => {
    const c = config(PUBLIC);
    expect(c.cookie).toMatchObject({ name: '__Host-nexora_session', secure: true });
  });

  it('COOKIE_NAME is the base name; the prefix is never doubled; __Host- without Secure is refused', () => {
    expect(config({ COOKIE_NAME: 'custom', COOKIE_SECURE: 'true' }).cookie.name).toBe(
      '__Host-custom',
    );
    expect(config({ COOKIE_NAME: '__Host-custom', COOKIE_SECURE: 'true' }).cookie.name).toBe(
      '__Host-custom',
    );
    expect(config({ COOKIE_NAME: 'custom' }).cookie.name).toBe('custom');
    expect(() => config({ COOKIE_NAME: '__Host-custom' })).toThrow(/requires Secure cookies/);
  });
});

describe('AUTH-007 — emitted cookie (HTTP)', () => {
  it('Secure configuration emits __Host-nexora_session with Secure; HttpOnly; Path=/; no Domain', async () => {
    const { app } = await buildTestApp({ env: { COOKIE_SECURE: 'true' } });
    const header = await loginCookie(app, '__Host-nexora_session');
    expect(header).toMatch(/;\s*Secure/i);
    expect(header).toMatch(/;\s*HttpOnly/i);
    expect(header).toMatch(/;\s*Path=\//);
    expect(header).not.toMatch(/Domain=/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Max-Age=28800/);
  });

  it('a production-like deployment (public origins, NODE_ENV unset) emits the same __Host- cookie', async () => {
    const { app } = await buildTestApp({ env: PUBLIC });
    const header = await loginCookie(app, '__Host-nexora_session');
    expect(header).toMatch(/;\s*Secure/i);
    expect(header).not.toMatch(/Domain=/i);
  });

  it('local HTTP development stays functional: unprefixed cookie, not Secure', async () => {
    const { app } = await buildTestApp();
    const header = await loginCookie(app, 'nexora_session');
    expect(header).not.toMatch(/;\s*Secure/i);
    expect(header).toMatch(/;\s*HttpOnly/i);
    expect(header).toMatch(/;\s*Path=\//);
    expect(header).not.toMatch(/Domain=/i);
    expect(header.startsWith('__Host-')).toBe(false);
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: pair(header) },
    });
    expect(me.statusCode).toBe(200);
  });

  it('authenticated requests succeed with the emitted cookie; the OTHER name is not an accepted credential', async () => {
    // Secure → only the prefixed name authenticates.
    const secure = await buildTestApp({ env: { COOKIE_SECURE: 'true' } });
    const header = await loginCookie(secure.app, '__Host-nexora_session');
    const token = pair(header).split('=')[1]!;
    const ok = await secure.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: pair(header) },
    });
    expect(ok.statusCode).toBe(200);
    const legacy = await secure.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `nexora_session=${token}` },
    });
    expect(legacy.statusCode).toBe(401);
    // Dev → only the unprefixed name authenticates.
    const dev = await buildTestApp();
    const devHeader = await loginCookie(dev.app, 'nexora_session');
    const devToken = pair(devHeader).split('=')[1]!;
    const prefixed = await dev.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `__Host-nexora_session=${devToken}` },
    });
    expect(prefixed.statusCode).toBe(401);
  });

  it('logout clears the ACTUAL emitted cookie (with Secure; Path=/, as a __Host- cookie requires) and ends the session', async () => {
    const { app } = await buildTestApp({ env: { COOKIE_SECURE: 'true' } });
    const header = await loginCookie(app, '__Host-nexora_session');
    const out = await app.inject({
      method: 'GET',
      url: '/api/auth/logout',
      headers: { cookie: pair(header), 'sec-fetch-site': 'same-origin' },
    });
    expect(out.statusCode).toBe(302);
    const cleared = setCookies(out).find((c) => c.startsWith('__Host-nexora_session=;'));
    expect(cleared, 'the prefixed cookie is cleared').toBeDefined();
    expect(cleared).toMatch(/;\s*Secure/i);
    expect(cleared).toMatch(/;\s*Path=\//);
    expect(cleared).not.toMatch(/Domain=/i);
    expect(cleared).toMatch(/Expires=/i);
    expect(
      (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: pair(header) } }))
        .statusCode,
    ).toBe(401);
  });

  it('demo sign-in sets the same configured cookie name', async () => {
    const { app } = await buildTestApp({
      env: { ...PUBLIC, NEXORA_DEMO_MODE: 'true', NEXORA_DEMO_ALLOW_IN_PRODUCTION: 'true' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/demo/login',
      headers: { 'content-type': 'application/json', origin: 'https://app.example.com' },
      payload: { persona: 'ceo' },
    });
    expect(res.statusCode).toBe(200);
    const header = setCookies(res).find((c) => c.startsWith('__Host-nexora_session='));
    expect(header).toMatch(/;\s*Secure/i);
    expect(header).not.toMatch(/Domain=/i);
  });
});

describe('AUTH-007 — no code path hard-codes the cookie name', () => {
  it('the only literal session-cookie name in production source is the configured base default', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../src');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          entry.name.endsWith('.ts') &&
          readFileSync(full, 'utf8').includes('nexora_session')
        ) {
          hits.push(full.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(hits).toEqual(['config.ts']);
  });
});
