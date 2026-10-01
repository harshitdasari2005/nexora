/**
 * AUTH-006 — the OIDC nonce is generated per login, bound to that login
 * transaction (HttpOnly cookie, like state and the PKCE verifier), sent in the
 * authorization request, and validated at the callback against the ID token.
 *
 * `FakeOidcGateway` models the IdP: the ID token carries the nonce of the
 * authorization request that produced the code, and the client must present
 * exactly its own. State and PKCE behaviour is unchanged.
 */

import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { FakeOidcGateway } from './fakes.js';
import { buildTestApp } from './helpers.js';

const setCookies = (response: { headers: Record<string, unknown> }): string[] =>
  ([] as string[]).concat((response.headers['set-cookie'] as string | string[] | undefined) ?? []);
const valueOf = (cookies: string[], name: string): string | undefined =>
  cookies
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.split('=')[1];
const isCleared = (cookies: string[], name: string): boolean =>
  cookies.some((c) => c.startsWith(`${name}=;`));

async function begin(app: FastifyInstance) {
  const res = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const cookies = setCookies(res);
  return {
    res,
    cookies,
    state: valueOf(cookies, 'oidc_state') as string,
    verifier: valueOf(cookies, 'oidc_verifier') as string,
    nonce: valueOf(cookies, 'oidc_nonce') as string,
  };
}

const callback = (
  app: FastifyInstance,
  tx: { state: string; verifier?: string; nonce?: string },
  queryExtra = '',
) =>
  app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=test-code&state=${tx.state}${queryExtra}`,
    headers: {
      cookie: [
        `oidc_state=${tx.state}`,
        ...(tx.verifier === undefined ? [] : [`oidc_verifier=${tx.verifier}`]),
        ...(tx.nonce === undefined ? [] : [`oidc_nonce=${tx.nonce}`]),
      ].join('; '),
    },
  });

async function setup() {
  const oidc = new FakeOidcGateway();
  const { app } = await buildTestApp({ oidc });
  return { app, oidc };
}

describe('AUTH-006 — login generates and binds a nonce', () => {
  it('sets a fresh, high-entropy, HttpOnly, short-lived nonce cookie and sends the SAME nonce in the authorization request', async () => {
    const { app } = await setup();
    const a = await begin(app);
    const cookie = a.cookies.find((c) => c.startsWith('oidc_nonce='))!;
    expect(a.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=600/);
    // Same attributes as the existing transaction cookies.
    const stateCookie = a.cookies.find((c) => c.startsWith('oidc_state='))!;
    expect(cookie.replace(/oidc_nonce=[^;]+/, '')).toBe(
      stateCookie.replace(/oidc_state=[^;]+/, ''),
    );
    // The authorization request carries it, alongside state and PKCE.
    const location = new URL(String(a.res.headers.location));
    expect(location.searchParams.get('nonce')).toBe(a.nonce);
    expect(location.searchParams.get('state')).toBe(a.state);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    // Unique per login attempt.
    const b = await begin(app);
    expect(b.nonce).not.toBe(a.nonce);
    // No session yet.
    expect(valueOf(a.cookies, 'nexora_session')).toBeUndefined();
  });
});

describe('AUTH-006 — callback validation', () => {
  it('a valid callback (matching nonce) succeeds, validates against the bound nonce, and clears every transaction cookie', async () => {
    const { app, oidc } = await setup();
    const tx = await begin(app);
    const res = await callback(app, tx);
    expect(res.statusCode).toBe(302);
    const cookies = setCookies(res);
    expect(valueOf(cookies, 'nexora_session')).toBeDefined();
    expect(oidc.exchangedNonces).toEqual([tx.nonce]);
    for (const name of ['oidc_state', 'oidc_verifier', 'oidc_nonce']) {
      expect(isCleared(cookies, name), name).toBe(true);
    }
  });

  it('a missing nonce cookie is rejected (400), no session, transaction cookies cleared', async () => {
    const { app } = await setup();
    const tx = await begin(app);
    const res = await callback(app, { state: tx.state, verifier: tx.verifier });
    expect(res.statusCode).toBe(400);
    const cookies = setCookies(res);
    expect(valueOf(cookies, 'nexora_session')).toBeUndefined();
    for (const name of ['oidc_state', 'oidc_verifier', 'oidc_nonce']) {
      expect(isCleared(cookies, name), name).toBe(true);
    }
  });

  it('a mismatched nonce is rejected (401), no session, cookies cleared; a nonce smuggled in the query is not trusted', async () => {
    const { app } = await setup();
    const tx = await begin(app);
    for (const query of ['', `&nonce=${tx.nonce}`]) {
      const fresh = await begin(app);
      const res = await callback(
        app,
        { ...fresh, nonce: 'forged-nonce-value' },
        query.replace(tx.nonce, fresh.nonce),
      );
      expect(res.statusCode, query).toBe(401);
      expect((res.json() as { error: { message: string } }).error.message).toBe(
        'Authentication failed',
      );
      const cookies = setCookies(res);
      expect(valueOf(cookies, 'nexora_session')).toBeUndefined();
      expect(isCleared(cookies, 'oidc_nonce')).toBe(true);
      expect(isCleared(cookies, 'oidc_state')).toBe(true);
    }
  });

  it('a stale or reused nonce is rejected: another login’s nonce, and a replay of a completed callback', async () => {
    const { app } = await setup();
    const first = await begin(app);
    const second = await begin(app);
    // Transaction 1's nonce presented with transaction 2's state/verifier.
    const crossed = await callback(app, { ...second, nonce: first.nonce });
    expect(crossed.statusCode).toBe(401);
    // A completed transaction cannot be replayed even if its cookies were kept.
    const done = await begin(app);
    expect((await callback(app, done)).statusCode).toBe(302);
    const replay = await callback(app, done);
    expect(replay.statusCode).toBe(401);
    expect(valueOf(setCookies(replay), 'nexora_session')).toBeUndefined();
  });

  it('state and PKCE failures behave exactly as before (400, cookies cleared)', async () => {
    const { app } = await setup();
    const tx = await begin(app);
    const wrongState = await app.inject({
      method: 'GET',
      url: '/api/auth/callback?code=c&state=wrong-state',
      headers: {
        cookie: `oidc_state=${tx.state}; oidc_verifier=${tx.verifier}; oidc_nonce=${tx.nonce}`,
      },
    });
    expect(wrongState.statusCode).toBe(400);
    const noVerifier = await callback(app, { state: tx.state, nonce: tx.nonce });
    expect(noVerifier.statusCode).toBe(400);
    for (const res of [wrongState, noVerifier]) {
      expect(valueOf(setCookies(res), 'nexora_session')).toBeUndefined();
      expect(isCleared(setCookies(res), 'oidc_nonce')).toBe(true);
    }
  });
});
