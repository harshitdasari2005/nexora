/**
 * AUTH-009 through the real HTTP stack on PostgreSQL: accounts are bound to the
 * OIDC identity (issuer + subject); email never switches or takes over a bound
 * account; legacy unbound accounts bind at their first login; a concurrent first
 * login binds exactly one identity; demo accounts are bound deterministically.
 *
 * Throwaway database; skips cleanly when Postgres is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import {
  createDatabaseFromPool,
  PgUserRepository,
  runMigrations,
  type NexoraDatabase,
} from '@nexora/persistence';
import {
  DisplayName,
  Email,
  PasswordHash,
  User,
  UserStatus,
  Username,
} from '@nexora/domain-identity';
import type { TenantId } from '@nexora/contracts/common';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { OidcCallbackParams, OidcIdentity, PkceParameters } from '../src/oidc/gateway.js';
import { FakeOidcGateway } from './fakes.js';
import { cookieValue } from './helpers.js';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';
const DB_NAME = 'nexora_oidc_binding_http_pg_test';
const withDatabase = (connectionString: string, name: string): string => {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
};
const DB_URL = withDatabase(BASE_URL, DB_NAME);
const MAINTENANCE_URL = withDatabase(BASE_URL, 'postgres');

async function isDatabaseReachable(): Promise<boolean> {
  const pool = new Pool({ connectionString: MAINTENANCE_URL, connectionTimeoutMillis: 1500 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}
const describeDb = (await isDatabaseReachable()) ? describe : describe.skip;

const ISSUER = 'http://keycloak.test/realms/nexora';
const OTHER_ISSUER = 'https://login.other-idp.example';

/** A fake IdP whose ID token identity is chosen PER login transaction (by state). */
class PerTransactionGateway extends FakeOidcGateway {
  readonly #byState = new Map<string, OidcIdentity>();
  override async buildAuthorizationUrl(state: string, pkce: PkceParameters, nonce: string) {
    return super.buildAuthorizationUrl(state, pkce, nonce);
  }
  expect(state: string, identity: OidcIdentity): void {
    this.#byState.set(state, identity);
  }
  override async exchangeCode(
    params: OidcCallbackParams,
    expectedState: string,
    codeVerifier: string,
    expectedNonce: string,
  ): Promise<OidcIdentity> {
    await super.exchangeCode(params, expectedState, codeVerifier, expectedNonce); // nonce/state model
    return this.#byState.get(expectedState) ?? this.identity;
  }
}

const identity = (over: Partial<OidcIdentity> = {}): OidcIdentity => ({
  subject: 'sub-alex',
  email: 'alex@nexora.dev',
  emailVerified: true,
  displayName: 'Alex Morgan',
  issuer: ISSUER,
  ...over,
});

describeDb('AUTH-009 — OIDC identity binding (HTTP + PostgreSQL)', () => {
  let pool: Pool;
  let db: NexoraDatabase;
  let app: FastifyInstance;
  let gateway: PerTransactionGateway;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: MAINTENANCE_URL });
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${DB_NAME}"`);
    } finally {
      await admin.end();
    }
    await runMigrations(DB_URL);
    pool = new Pool({ connectionString: DB_URL });
    db = createDatabaseFromPool(pool);
    gateway = new PerTransactionGateway();
    app = await buildApp({
      config: loadConfig({
        DATABASE_URL: DB_URL,
        LOG_LEVEL: 'error',
        INTEGRATIONS_INBOUND_SECRET: 'test-inbound-secret',
        NEXORA_DEMO_MODE: 'true',
      } as NodeJS.ProcessEnv),
      oidc: gateway,
      database: db,
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    const admin = new Pool({ connectionString: MAINTENANCE_URL });
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  /** One login dance as `who`; returns the callback response. */
  async function login(who: OidcIdentity) {
    const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const get = (n: string) => cookieValue(start, n)!.split('=')[1]!;
    const state = get('oidc_state');
    gateway.expect(state, who);
    return app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=c&state=${state}`,
      headers: {
        cookie: `oidc_state=${state}; oidc_verifier=${get('oidc_verifier')}; oidc_nonce=${get('oidc_nonce')}`,
      },
    });
  }
  const sessionOf = (res: { headers: Record<string, unknown> }): string | undefined =>
    cookieValue(res, 'nexora_session');
  const me = (cookie: string) => app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
  const userRows = async (email: string) =>
    (await pool.query('SELECT id, oidc_issuer, oidc_subject FROM users WHERE email = $1', [email]))
      .rows;
  const userCount = async () =>
    (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n as number;

  it('first login creates the user BOUND to issuer + subject; the same identity returns to the same account; sessions stay valid', async () => {
    const a = identity({ email: 'first@nexora.dev', subject: 'sub-first' });
    const res = await login(a);
    expect(res.statusCode).toBe(302);
    const s1 = sessionOf(res)!;
    expect(await userRows('first@nexora.dev')).toEqual([
      expect.objectContaining({ oidc_issuer: ISSUER, oidc_subject: 'sub-first' }),
    ]);
    const before = await userCount();
    const again = await login(a);
    expect(again.statusCode).toBe(302);
    expect(await userCount()).toBe(before); // no second account
    expect((await me(s1)).statusCode).toBe(200); // the first session is still valid
    // Binding data is authentication-internal: never in a user response.
    const body = (await me(s1)).body;
    expect(body).not.toContain('sub-first');
    expect(body).not.toContain(ISSUER);
    expect(body.toLowerCase()).not.toContain('oidc');
  });

  it('same email + different subject, or different issuer, is rejected with a generic error and changes nothing', async () => {
    const owner = identity({ email: 'victim@nexora.dev', subject: 'sub-victim' });
    const ok = await login(owner);
    const victimSession = sessionOf(ok)!;
    const before = await userCount();
    for (const attacker of [
      identity({ email: 'victim@nexora.dev', subject: 'sub-attacker' }),
      identity({ email: 'victim@nexora.dev', subject: 'sub-victim', issuer: OTHER_ISSUER }),
      identity({ email: 'VICTIM@nexora.dev ', subject: 'sub-attacker-2' }),
    ]) {
      const res = await login(attacker);
      expect(res.statusCode, JSON.stringify(attacker)).toBeGreaterThanOrEqual(400);
      expect(sessionOf(res)).toBeUndefined();
      const text = res.body;
      for (const leak of ['sub-victim', ISSUER, OTHER_ISSUER, 'sub-attacker', 'oidc_']) {
        expect(text).not.toContain(leak);
      }
      expect(JSON.parse(text).error.message).toBe('Invalid credentials');
    }
    expect(await userCount()).toBe(before);
    expect(await userRows('victim@nexora.dev')).toEqual([
      expect.objectContaining({ oidc_issuer: ISSUER, oidc_subject: 'sub-victim' }),
    ]);
    expect((await me(victimSession)).statusCode).toBe(200);
  });

  it('a different email with the SAME issuer + subject logs into the bound account (no new account)', async () => {
    const first = await login(identity({ email: 'renamed-old@nexora.dev', subject: 'sub-rename' }));
    const original = (await me(sessionOf(first)!)).json() as {
      user: { id: string; email: string };
    };
    const before = await userCount();
    const renamed = await login(
      identity({ email: 'renamed-new@nexora.dev', subject: 'sub-rename' }),
    );
    expect(renamed.statusCode).toBe(302);
    const after = (await me(sessionOf(renamed)!)).json() as { user: { id: string; email: string } };
    expect(after.user.id).toBe(original.user.id);
    expect(after.user.email).toBe('renamed-old@nexora.dev');
    expect(await userCount()).toBe(before);
  });

  it('email_verified=false creates and binds nothing', async () => {
    const before = await userCount();
    const res = await login(
      identity({ email: 'unverified@nexora.dev', subject: 'sub-unv', emailVerified: false }),
    );
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(sessionOf(res)).toBeUndefined();
    expect(await userCount()).toBe(before);
    expect(await userRows('unverified@nexora.dev')).toEqual([]);
  });

  async function legacy(email: string): Promise<string> {
    const user = User.create(
      {
        tenantId: 'tnt_platform' as TenantId,
        email: Email.create(email),
        username: Username.create(email.split('@')[0]!),
        passwordHash: PasswordHash.create('scrypt', 'oidc-unusable'),
        displayName: DisplayName.create('Legacy'),
        status: UserStatus.active(),
      },
      {
        actor: { kind: 'user', id: 'legacy' },
        correlationId: 'c',
        tenantId: 'tnt_platform' as TenantId,
      },
    );
    await new PgUserRepository(db).save(user);
    return user.id;
  }

  it('a legacy UNBOUND account binds at its first OIDC login; the same identity then works; a different identity with the same email is rejected', async () => {
    const id = await legacy('legacy-one@nexora.dev');
    expect((await userRows('legacy-one@nexora.dev'))[0].oidc_issuer).toBeNull();
    const first = await login(
      identity({ email: 'legacy-one@nexora.dev', subject: 'sub-legacy-one' }),
    );
    expect(first.statusCode).toBe(302);
    expect(await userRows('legacy-one@nexora.dev')).toEqual([
      { id, oidc_issuer: ISSUER, oidc_subject: 'sub-legacy-one' },
    ]);
    expect(
      (await login(identity({ email: 'legacy-one@nexora.dev', subject: 'sub-legacy-one' })))
        .statusCode,
    ).toBe(302);
    const other = await login(
      identity({ email: 'legacy-one@nexora.dev', subject: 'sub-intruder' }),
    );
    expect(other.statusCode).toBeGreaterThanOrEqual(400);
    expect((await userRows('legacy-one@nexora.dev'))[0].oidc_subject).toBe('sub-legacy-one');
  });

  it('RACE over HTTP: simultaneous first logins for one legacy account with different subjects bind exactly one identity', async () => {
    const id = await legacy('legacy-race@nexora.dev');
    const results = await Promise.all(
      ['A', 'B', 'C', 'D'].map((n) =>
        login(identity({ email: 'legacy-race@nexora.dev', subject: `sub-race-${n}` })),
      ),
    );
    const succeeded = results.filter((r) => r.statusCode === 302);
    expect(succeeded).toHaveLength(1);
    const rows = await userRows('legacy-race@nexora.dev');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(['sub-race-A', 'sub-race-B', 'sub-race-C', 'sub-race-D']).toContain(
      rows[0].oidc_subject,
    );
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM users WHERE email = 'legacy-race@nexora.dev'`,
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('demo accounts are bound deterministically (nexora-demo / demo:<persona>) and demo sign-in, reset and re-sign-in work', async () => {
    const rows = await pool.query(
      `SELECT oidc_issuer, oidc_subject FROM users WHERE email LIKE '%@lumen-capital.example' ORDER BY oidc_subject`,
    );
    expect(rows.rows).toEqual(
      ['cfo', 'ceo', 'controller', 'manager']
        .sort()
        .map((k) => ({ oidc_issuer: 'nexora-demo', oidc_subject: `demo:${k}` })),
    );
    const signIn = (persona: string) =>
      app.inject({
        method: 'POST',
        url: '/api/demo/login',
        headers: { 'content-type': 'application/json' },
        payload: { persona },
      });
    const ceo = await signIn('ceo');
    expect(ceo.statusCode).toBe(200);
    const cookie = cookieValue(ceo, 'nexora_session')!;
    expect((await me(cookie)).statusCode).toBe(200);
    const reset = await app.inject({ method: 'POST', url: '/api/demo/reset', headers: { cookie } });
    expect(reset.statusCode).toBe(200);
    const after = await pool.query(
      `SELECT oidc_issuer, oidc_subject FROM users WHERE email = 'anika.rao@lumen-capital.example'`,
    );
    expect(after.rows).toEqual([{ oidc_issuer: 'nexora-demo', oidc_subject: 'demo:ceo' }]);
    expect((await signIn('manager')).statusCode).toBe(200);
  });
});
