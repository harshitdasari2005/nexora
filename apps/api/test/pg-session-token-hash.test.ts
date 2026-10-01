/**
 * AUTH-004 through the real HTTP stack on PostgreSQL: login → cookie → DB row →
 * authenticated request → logout. The cookie carries the raw token; the
 * database row carries only its SHA-256 digest.
 *
 * Throwaway database from the repo migrations; skips cleanly when Postgres is unreachable.
 */

import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { FakeOidcGateway } from './fakes.js';
import { cookieValue } from './helpers.js';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';
const DB_NAME = 'nexora_session_hash_http_pg_test';

function withDatabase(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

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

describeDb('AUTH-004 — session tokens are hashed at rest (HTTP + PostgreSQL)', () => {
  let pool: Pool;
  let db: NexoraDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;

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
    app = await buildApp({
      config: loadConfig({
        DATABASE_URL: DB_URL,
        LOG_LEVEL: 'error',
        INTEGRATIONS_INBOUND_SECRET: 'test-inbound-secret',
      } as NodeJS.ProcessEnv),
      oidc: new FakeOidcGateway(),
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

  async function loginRaw(): Promise<string> {
    const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const state = cookieValue(start, 'oidc_state')?.split('=')[1] ?? '';
    const verifier = cookieValue(start, 'oidc_verifier')?.split('=')[1] ?? '';
    const nonce = cookieValue(start, 'oidc_nonce')?.split('=')[1] ?? '';
    const cb = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=c&state=${state}`,
      headers: { cookie: `oidc_state=${state}; oidc_verifier=${verifier}; oidc_nonce=${nonce}` },
    });
    expect(cb.statusCode).toBe(302);
    return String(cookieValue(cb, 'nexora_session')?.split(';')[0]).split('=')[1] as string;
  }
  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `nexora_session=${token}` } });

  it('the cookie token is raw; the database stores only its SHA-256 digest; the row never contains the token', async () => {
    const raw = await loginRaw();
    const digest = createHash('sha256').update(raw).digest('hex');
    const { rows } = await pool.query('SELECT * FROM sessions WHERE token_hash = $1', [digest]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(raw);
    expect(JSON.stringify(rows[0])).not.toContain(raw);
    // And no table-wide leak: the raw token appears in no sessions column at all.
    const leak = await pool.query(
      `SELECT count(*)::int AS n FROM sessions s WHERE s::text LIKE '%' || $1 || '%'`,
      [raw],
    );
    expect(leak.rows[0].n).toBe(0);
  });

  it('authenticates with the raw token; a one-character change, the stored digest, and a blank token do not', async () => {
    const raw = await loginRaw();
    expect((await me(raw)).statusCode).toBe(200);
    const flipped = `${raw.slice(0, -1)}${raw.endsWith('0') ? '1' : '0'}`;
    expect((await me(flipped)).statusCode).toBe(401);
    expect((await me(createHash('sha256').update(raw).digest('hex'))).statusCode).toBe(401);
    expect((await me('')).statusCode).toBe(401);
  });

  it('logout still invalidates the session', async () => {
    const raw = await loginRaw();
    expect((await me(raw)).statusCode).toBe(200);
    const out = await app.inject({
      method: 'GET',
      url: '/api/auth/logout',
      headers: { cookie: `nexora_session=${raw}`, 'sec-fetch-site': 'same-origin' },
    });
    expect(out.statusCode).toBe(302);
    expect((await me(raw)).statusCode).toBe(401);
  });
});
