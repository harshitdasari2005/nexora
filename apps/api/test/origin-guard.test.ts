/**
 * AUTH-008 — browser-origin guard for state-changing authenticated requests.
 *
 * The decision is made from the request's `Origin` (and, only to ADD a
 * rejection, `Sec-Fetch-Site`) against TRUSTED origins from configuration —
 * never from the body, query, path, `Host`, `Referer` or any client-asserted
 * claim. Non-browser clients (no `Origin`), signed webhooks and MCP clients
 * keep working.
 */

import { describe, expect, it } from 'vitest';

import { decideOrigin, originOf, trustedOrigins } from '../src/plugins/origin-guard.js';
import { loadConfig } from '../src/config.js';
import { FakeOidcGateway } from './fakes.js';
import { buildTestApp, login } from './helpers.js';

const WEB = 'http://localhost:5173'; // the default WEB_ORIGIN
const API = 'http://localhost:3001'; // the default OIDC_REDIRECT_URI origin (the API itself)
const ATTACKER = 'https://attacker.example';

async function session(env: Record<string, string> = {}) {
  const { app, repos } = await buildTestApp({ oidc: new FakeOidcGateway(), env });
  const cookie = await login(app);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: path,
      headers: { cookie, 'content-type': 'application/json', ...headers },
      payload: body as object,
    });
  const orgs = async () =>
    (
      (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json() as {
        organizations: unknown[];
      }
    ).organizations.length;
  return { app, repos, cookie, post, orgs };
}

const ORG = { name: 'Acme Inc.', slug: 'acme', type: 'startup' };

describe('AUTH-008 — decideOrigin (pure)', () => {
  const trusted = new Set([WEB, API]);

  it('trusts only configured origins; missing Origin is allowed unless the browser says cross-site', () => {
    expect(decideOrigin({ origin: WEB }, trusted)).toEqual({ allowed: true });
    expect(decideOrigin({ origin: API }, trusted)).toEqual({ allowed: true });
    for (const origin of [
      ATTACKER,
      'null',
      '',
      'not a url',
      'http://localhost:5174',
      'https://localhost:5173',
      'http://localhost:5173.attacker.example',
      'http://attacker.example/http://localhost:5173',
      'ftp://localhost:5173',
    ]) {
      expect(decideOrigin({ origin }, trusted).allowed, origin).toBe(false);
    }
    expect(decideOrigin({}, trusted)).toEqual({ allowed: true });
    expect(decideOrigin({ secFetchSite: 'cross-site' }, trusted).allowed).toBe(false);
    for (const site of ['same-origin', 'same-site', 'none']) {
      expect(decideOrigin({ secFetchSite: site }, trusted).allowed, site).toBe(true);
    }
    // Sec-Fetch-Site never grants trust: an untrusted Origin stays rejected.
    expect(decideOrigin({ origin: ATTACKER, secFetchSite: 'same-origin' }, trusted).allowed).toBe(
      false,
    );
  });

  it('derives trusted origins from configuration only', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      INTEGRATIONS_INBOUND_SECRET: 's',
    } as NodeJS.ProcessEnv);
    expect([...trustedOrigins(config)].sort()).toEqual([API, WEB].sort());
    expect(originOf('https://app.example.com/some/path?x=1')).toBe('https://app.example.com');
    expect(originOf('javascript:alert(1)')).toBeUndefined();
  });
});

describe('AUTH-008 — authenticated state-changing requests (HTTP)', () => {
  it('same-origin (trusted Origin) mutation succeeds', async () => {
    const s = await session();
    for (const [index, origin] of [WEB, API].entries()) {
      const res = await s.post(
        '/api/organizations',
        { ...ORG, slug: `acme-same-${index}` },
        { origin },
      );
      expect(res.statusCode, origin).toBe(201);
    }
  });

  it('a cross-origin mutation is rejected (403) and changes nothing', async () => {
    const s = await session();
    const before = await s.orgs();
    const res = await s.post('/api/organizations', ORG, { origin: ATTACKER });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AUTHORIZATION_ERROR');
    expect(await s.orgs()).toBe(before);
  });

  it('every state-changing method is guarded, including the opaque null origin', async () => {
    const s = await session();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await s.app.inject({
        method,
        url: '/api/organizations',
        headers: { cookie: s.cookie, 'content-type': 'application/json', origin: 'null' },
        payload: {},
      });
      expect(res.statusCode, method).toBe(403);
    }
  });

  it('a forged same-origin signal cannot bypass it (Referer / Host / forwarded headers / Sec-Fetch-Site are not trusted)', async () => {
    const s = await session();
    const res = await s.post('/api/organizations', ORG, {
      origin: ATTACKER,
      referer: `${WEB}/app`,
      host: 'localhost:5173',
      'x-forwarded-host': 'localhost:5173',
      'x-forwarded-proto': 'http',
      'x-original-origin': WEB,
      'sec-fetch-site': 'same-origin',
    });
    expect(res.statusCode).toBe(403);
    // A look-alike of the trusted origin is not the trusted origin.
    for (const origin of ['http://localhost:5173.attacker.example', 'https://localhost:5173']) {
      expect((await s.post('/api/organizations', ORG, { origin })).statusCode, origin).toBe(403);
    }
    // Request data cannot influence trust either.
    const viaBody = await s.post(
      '/api/organizations',
      { ...ORG, origin: WEB, trusted: true },
      { origin: ATTACKER },
    );
    expect(viaBody.statusCode).toBe(403);
  });

  it('a request with no Origin (non-browser/API/MCP clients, tests) is unaffected — unless the browser marks it cross-site', async () => {
    const s = await session();
    expect((await s.post('/api/organizations', ORG)).statusCode).toBe(201);
    expect(
      (
        await s.post(
          '/api/organizations',
          { ...ORG, slug: 'acme-2' },
          { 'sec-fetch-site': 'same-origin' },
        )
      ).statusCode,
    ).toBe(201);
    const cross = await s.post(
      '/api/organizations',
      { ...ORG, slug: 'acme-3' },
      { 'sec-fetch-site': 'cross-site' },
    );
    expect(cross.statusCode).toBe(403);
  });

  it('read-only requests are unaffected, whatever the Origin', async () => {
    const s = await session();
    for (const origin of [ATTACKER, 'null', WEB]) {
      const res = await s.app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: s.cookie, origin },
      });
      expect(res.statusCode, origin).toBe(200);
    }
  });

  it('tenant/workspace behavior is unchanged: a same-origin request still goes through authorization (foreign org → 403 from authz, not the guard)', async () => {
    const s = await session();
    const res = await s.post(
      '/api/projects',
      { organizationId: 'org_foreign', name: 'X' },
      { origin: WEB },
    );
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { message: string } }).error.message).not.toBe(
      'Cross-origin request rejected',
    );
  });
});

describe('AUTH-008 — logout is not a cross-site sign-out primitive', () => {
  it('a cross-site logout (Origin or Sec-Fetch-Site) is rejected and the session survives; a same-origin logout works', async () => {
    const s = await session();
    for (const headers of [{ origin: ATTACKER }, { 'sec-fetch-site': 'cross-site' }]) {
      const res = await s.app.inject({
        method: 'GET',
        url: '/api/auth/logout',
        headers: { cookie: s.cookie, ...headers },
      });
      expect(res.statusCode).toBe(403);
      expect(
        (await s.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: s.cookie } }))
          .statusCode,
      ).toBe(200);
    }
    // The in-app link: a same-origin top-level navigation (no Origin, Sec-Fetch-Site same-origin).
    const ok = await s.app.inject({
      method: 'GET',
      url: '/api/auth/logout',
      headers: { cookie: s.cookie, 'sec-fetch-site': 'same-origin' },
    });
    expect(ok.statusCode).toBe(302);
    expect(
      (await s.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: s.cookie } }))
        .statusCode,
    ).toBe(401);
  });
});

describe('AUTH-008 — SameSite=None does not reopen CSRF', () => {
  it('with COOKIE_SAME_SITE=none the cookie is sent cross-site, but the cross-origin mutation is still rejected', async () => {
    const { app } = await buildTestApp({
      oidc: new FakeOidcGateway(),
      env: { COOKIE_SAME_SITE: 'none', COOKIE_SECURE: 'true' },
    });
    const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const state = /oidc_state=([^;]+)/.exec(String(start.headers['set-cookie']))?.[1] ?? '';
    const verifier = /oidc_verifier=([^;]+)/.exec(String(start.headers['set-cookie']))?.[1] ?? '';
    const nonce = /oidc_nonce=([^;]+)/.exec(String(start.headers['set-cookie']))?.[1] ?? '';
    const cb = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=c&state=${state}`,
      headers: { cookie: `oidc_state=${state}; oidc_verifier=${verifier}; oidc_nonce=${nonce}` },
    });
    const raw = ([] as string[]).concat(cb.headers['set-cookie'] as string | string[]);
    const sessionCookie = raw.find((c) => c.startsWith('__Host-nexora_session='))!;
    expect(sessionCookie).toMatch(/SameSite=None/i);
    const cookie = sessionCookie.split(';')[0]!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/organizations',
      headers: { cookie, 'content-type': 'application/json', origin: ATTACKER },
      payload: ORG,
    });
    expect(res.statusCode).toBe(403);
    const same = await app.inject({
      method: 'POST',
      url: '/api/organizations',
      headers: { cookie, 'content-type': 'application/json', origin: WEB },
      payload: ORG,
    });
    expect(same.statusCode).toBe(201);
  });
});

describe('AUTH-008 — machine and MCP clients keep their own authentication', () => {
  it('the signed inbound webhook is exempt: even with a hostile Origin it reaches its signature check (401, not 403)', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/email/inbound',
      headers: { 'content-type': 'application/json', origin: ATTACKER },
      payload: { organizationId: 'org_x' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('x-nexora-inbound-signature');
  });

  it('MCP: unauthenticated stays 401 with no Origin; a cookie-bearing browser POST from another origin is rejected; the SDK-style client (no Origin) is unaffected', async () => {
    const s = await session();
    const rpc = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const unauth = await s.app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { 'content-type': 'application/json' },
      payload: rpc,
    });
    expect(unauth.statusCode).toBe(401);
    const forged = await s.post('/api/mcp', rpc, { origin: ATTACKER });
    expect(forged.statusCode).toBe(403);
    const client = await s.post('/api/mcp', rpc, { accept: 'application/json, text/event-stream' });
    expect(client.statusCode).not.toBe(403);
    expect(client.statusCode).not.toBe(401);
  });

  it('demo sign-in (public, state-changing) is origin-guarded too', async () => {
    const { app } = await buildTestApp({ env: { NEXORA_DEMO_MODE: 'true' } });
    const hostile = await app.inject({
      method: 'POST',
      url: '/api/demo/login',
      headers: { 'content-type': 'application/json', origin: ATTACKER },
      payload: { persona: 'ceo' },
    });
    expect(hostile.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/demo/login',
      headers: { 'content-type': 'application/json', origin: WEB },
      payload: { persona: 'ceo' },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('AUTH-008 follow-up — same-site, different-origin pages cannot force logout', () => {
  const trusted = new Set([WEB, API]);

  it('decideOrigin with requireSameOrigin: only same-origin / none / no-metadata clients pass; same-site and cross-site do not', () => {
    const strict = { requireSameOrigin: true };
    for (const site of ['same-origin', 'none']) {
      expect(decideOrigin({ secFetchSite: site }, trusted, strict).allowed, site).toBe(true);
    }
    expect(decideOrigin({}, trusted, strict).allowed).toBe(true); // non-browser client, no metadata
    for (const site of ['same-site', 'cross-site', 'weird-value']) {
      expect(decideOrigin({ secFetchSite: site }, trusted, strict).allowed, site).toBe(false);
    }
    expect(decideOrigin({ origin: WEB, secFetchSite: 'same-site' }, trusted, strict).allowed).toBe(
      true,
    ); // exact trusted Origin wins
    expect(decideOrigin({ origin: 'http://localhost:5998' }, trusted, strict).allowed).toBe(false);
    // The mutating-request rule is unchanged: same-site without Origin is still allowed there.
    expect(decideOrigin({ secFetchSite: 'same-site' }, trusted).allowed).toBe(true);
  });

  it('REPRODUCTION (victim session → same-site attacker origin → logout): 403, and /api/me stays 200', async () => {
    const s = await session();
    const meStatus = async () =>
      (await s.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: s.cookie } }))
        .statusCode;
    expect(await meStatus()).toBe(200);
    // What a browser sends for <img src=".../api/auth/logout"> on http://localhost:5998
    // (same site as localhost:5173/3001, different origin): cookie attached, no Origin.
    const forged = await s.app.inject({
      method: 'GET',
      url: '/api/auth/logout',
      headers: {
        cookie: s.cookie,
        'sec-fetch-site': 'same-site',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-dest': 'image',
        referer: 'http://localhost:5998/',
      },
    });
    expect(forged.statusCode).toBe(403);
    expect(await meStatus()).toBe(200);
  });

  it('every non-same-origin variant is rejected and leaves the session valid; same-origin still signs out with the existing redirect', async () => {
    const s = await session();
    const logout = (headers: Record<string, string>) =>
      s.app.inject({
        method: 'GET',
        url: '/api/auth/logout',
        headers: { cookie: s.cookie, ...headers },
      });
    const stillValid = async () =>
      (await s.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: s.cookie } }))
        .statusCode;
    const hostile: Record<string, string>[] = [
      { 'sec-fetch-site': 'same-site' }, // no Origin + same-site
      { 'sec-fetch-site': 'cross-site' }, // no Origin + cross-site
      { origin: 'http://localhost:5998', 'sec-fetch-site': 'same-site' }, // same-site other port
      { origin: 'http://127.0.0.1:5998', 'sec-fetch-site': 'cross-site' }, // other host
      { origin: ATTACKER },
      { origin: 'null' },
      // Forged helper headers are not proof of anything:
      {
        'sec-fetch-site': 'same-site',
        referer: `${WEB}/app`,
        host: 'localhost:5173',
        'x-forwarded-host': 'localhost:5173',
      },
    ];
    for (const headers of hostile) {
      expect((await logout(headers)).statusCode, JSON.stringify(headers)).toBe(403);
      expect(await stillValid()).toBe(200);
    }
    // The real in-app link: a same-origin top-level navigation (and a user-typed URL).
    const ok = await logout({
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    });
    expect(ok.statusCode).toBe(302);
    expect(await stillValid()).toBe(401);
  });

  it('a user-typed/bookmarked logout URL (Sec-Fetch-Site: none) and a non-browser client (no metadata) still work', async () => {
    for (const headers of [{ 'sec-fetch-site': 'none' }, {}]) {
      const s = await session();
      const out = await s.app.inject({
        method: 'GET',
        url: '/api/auth/logout',
        headers: { cookie: s.cookie, ...headers },
      });
      expect(out.statusCode, JSON.stringify(headers)).toBe(302);
      expect(
        (await s.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: s.cookie } }))
          .statusCode,
      ).toBe(401);
    }
  });

  it('mutating methods and reads are unchanged by the stricter GET rule', async () => {
    const s = await session();
    // Same-site WITH a trusted Origin / no Origin: POST behaves exactly as before.
    expect(
      (await s.post('/api/organizations', ORG, { 'sec-fetch-site': 'same-site' })).statusCode,
    ).toBe(201);
    expect(
      (await s.post('/api/organizations', { ...ORG, slug: 'acme-b' }, { origin: ATTACKER }))
        .statusCode,
    ).toBe(403);
    // Reads (non-logout GETs) are not guarded at all, whatever the metadata.
    for (const headers of [
      { 'sec-fetch-site': 'same-site' },
      { 'sec-fetch-site': 'cross-site' },
      { origin: ATTACKER },
    ]) {
      expect(
        (
          await s.app.inject({
            method: 'GET',
            url: '/api/me',
            headers: { cookie: s.cookie, ...headers },
          })
        ).statusCode,
        JSON.stringify(headers),
      ).toBe(200);
    }
  });
});
