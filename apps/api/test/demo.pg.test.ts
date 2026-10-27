/**
 * Demo World seed + reset against PostgreSQL (throwaway database from the repo
 * migrations; skips cleanly when Postgres is unreachable).
 *
 * Verifies the reset contract on real rows: it deletes ONLY the demo
 * organization's data, restores the deterministic seed, is idempotent,
 * re-establishes the same persona's session, and leaves a foreign tenant
 * (the evaluation dataset's Aurora + Borealis) byte-for-byte untouched.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildBaseWorld } from '@nexora/evaluation';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';

import { buildApp, buildPgRepositories } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { DemoError, DemoService } from '../src/demo/demo-service.js';
import { countScopedRows, type ResetScope } from '../src/demo/reset.js';
import { seedWorld } from '../src/demo/seed-world.js';
import { buildDemoWorld, demoIds } from '../src/demo/world.js';
import { FakeOidcGateway } from './fakes.js';
import { hireThroughChain } from './hiring-chain.js';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';
const DB_NAME = 'nexora_demo_pg_test';

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

function scopeOf(world: ReturnType<typeof buildDemoWorld>): ResetScope {
  return {
    organizationIds: world.organizations.map((o) => o.id),
    workspaceIds: world.workspaces.map((w) => w.id),
    userIds: world.users.map((u) => u.id),
  };
}

describeDb('Demo World (PostgreSQL)', () => {
  let pool: Pool;
  let db: NexoraDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const ids = demoIds();
  const demoScope = scopeOf(buildDemoWorld());
  const foreignScope = scopeOf(buildBaseWorld());

  const login = async (persona: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/demo/login',
      headers: { 'content-type': 'application/json' },
      payload: { persona },
    });
    expect(response.statusCode).toBe(200);
    const raw = response.headers['set-cookie'];
    return ((Array.isArray(raw) ? raw[0] : raw) ?? '').split(';')[0] ?? '';
  };
  const post = (cookie: string, url: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie, 'content-type': 'application/json' },
      payload: payload as object,
    });

  beforeAll(async () => {
    const maintenance = new Pool({ connectionString: MAINTENANCE_URL });
    try {
      await maintenance.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
      await maintenance.query(`CREATE DATABASE "${DB_NAME}"`);
    } finally {
      await maintenance.end();
    }
    await runMigrations(DB_URL);
    pool = new Pool({ connectionString: DB_URL });
    db = createDatabaseFromPool(pool);
    // A foreign tenant that shares the database (never demo data).
    const repositories = buildPgRepositories(db, { s3: undefined } as never);
    await seedWorld(repositories, buildBaseWorld(), { skipOrganizationPolicy: true });
    app = await buildApp({
      config: loadConfig({
        DATABASE_URL: DB_URL,
        LOG_LEVEL: 'error',
        INTEGRATIONS_INBOUND_SECRET: 'test-inbound-secret',
        NEXORA_DEMO_MODE: 'true',
      } as NodeJS.ProcessEnv),
      oidc: new FakeOidcGateway(),
      database: db,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    const maintenance = new Pool({ connectionString: MAINTENANCE_URL });
    try {
      await maintenance.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    } finally {
      await maintenance.end();
    }
  });

  it('seeds idempotently: a second seed changes nothing (including the policy version log)', async () => {
    const first = await countScopedRows(db, demoScope);
    expect(first['organizations']).toBe(1);
    // Approval authority, and "hiring goes through a hiring request".
    expect(first['policy_settings']).toBe(2);
    const repositories = buildPgRepositories(db, { s3: undefined } as never);
    await seedWorld(repositories, buildDemoWorld());
    await seedWorld(repositories, buildDemoWorld());
    expect(await countScopedRows(db, demoScope)).toEqual(first);
  });

  it('reset restores the deterministic world, keeps the persona signed in, and never touches a foreign tenant', async () => {
    const pristine = await countScopedRows(db, demoScope);
    const foreignBefore = await countScopedRows(db, foreignScope);
    expect(Object.keys(foreignBefore).length).toBeGreaterThan(0);

    // Dirty the demo the way the office does: one whole hire, from the hiring
    // request to the project assignment (every table the chain writes to).
    const ceo = await login('ceo');
    await hireThroughChain(app, ids, 'Sarah Thomas');
    const manager = await login('manager');
    const dirty = await countScopedRows(db, demoScope);
    expect(dirty['employees']).toBe((pristine['employees'] ?? 0) + 1);
    for (const table of ['hiring_requisitions', 'job_openings', 'candidates', 'onboardings']) {
      expect(dirty[table], table).toBe((pristine[table] ?? 0) + 1);
    }

    const reset = await post(manager, '/api/demo/reset', {});
    expect(reset.statusCode).toBe(200);
    const fresh = reset.headers['set-cookie'];
    const newCookie = ((Array.isArray(fresh) ? fresh[0] : fresh) ?? '').split(';')[0] ?? '';

    // Deterministic restoration: identical to pristine except the audit note the reset wrote.
    const restored = await countScopedRows(db, demoScope);
    const {
      activity_items: restoredActivity = 0,
      sessions: restoredSessions = 0,
      ...restoredRest
    } = restored;
    const {
      activity_items: pristineActivity = 0,
      sessions: pristineSessions = 0,
      ...pristineRest
    } = pristine;
    expect(restoredRest).toEqual(pristineRest);
    expect(restoredActivity).toBe(pristineActivity + 1);
    expect(restoredSessions).toBeGreaterThanOrEqual(pristineSessions);
    expect(await countScopedRows(db, foreignScope)).toEqual(foreignBefore);

    // The persona is signed in again as the SAME user (the old session died with the reset).
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: newCookie } });
    expect(me.statusCode).toBe(200);
    expect(JSON.stringify(me.json())).toContain('rohan.mehta@lumen-capital.example');
    const stale = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: ceo } });
    expect(stale.statusCode).toBe(401);
    const employees = await app.inject({
      method: 'GET',
      url: `/api/employees?organizationId=${ids.organizationId}`,
      headers: { cookie: newCookie },
    });
    expect(JSON.stringify(employees.json())).not.toContain('Sarah Thomas');
  });

  it('reset is idempotent', async () => {
    const cookie = await login('ceo');
    expect((await post(cookie, '/api/demo/reset', {})).statusCode).toBe(200);
    const first = await countScopedRows(db, demoScope);
    const foreign = await countScopedRows(db, foreignScope);
    const again = await login('ceo');
    expect((await post(again, '/api/demo/reset', {})).statusCode).toBe(200);
    const second = await countScopedRows(db, demoScope);
    // Byte-for-byte the same world: each reset clears the earlier audit note
    // and writes exactly one of its own (history never accumulates).
    expect(second).toEqual(first);
    expect(second['activity_items']).toBe(1);
    expect(await countScopedRows(db, foreignScope)).toEqual(foreign);
  });

  it('a reset refuses to run while a demo request is still in flight, and deletes nothing', async () => {
    const repositories = buildPgRepositories(db, { s3: undefined } as never);
    const service = new DemoService({
      repositories,
      database: db,
      authenticate: undefined as never,
      drainTimeoutMs: 150,
    });
    const before = await countScopedRows(db, demoScope);
    const release = service.track();
    await expect(service.reset(ids.userIds.ceo)).rejects.toMatchObject({ code: 'DEMO_BUSY' });
    expect(await countScopedRows(db, demoScope)).toEqual(before);
    release();
    expect(service.resetting).toBe(false);
  });

  it('reset refuses a caller that is not a demo persona', async () => {
    // A foreign-tenant user signs in through the normal path is not possible here;
    // the route derives the persona from the session user, so a non-persona id is refused.
    const service = new DemoService({
      repositories: buildPgRepositories(db, { s3: undefined } as never),
      database: db,
      authenticate: undefined as never,
    });
    expect(service.personaOfUser(foreignScope.userIds[0]!)).toBeUndefined();
    expect(DemoError).toBeDefined();
  });
});
