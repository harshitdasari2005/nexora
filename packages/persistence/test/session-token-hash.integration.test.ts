/**
 * AUTH-004 on real PostgreSQL: sessions store only the SHA-256 digest of the
 * bearer token, lookup is an indexed exact match, and migration 0025
 * invalidates every pre-existing session (which held RAW tokens) and removes the
 * raw column.
 *
 * Runs against a THROWAWAY database; skips cleanly when Postgres is unreachable.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { TenantId, UserId } from '@nexora/contracts/common';
import {
  hashSessionToken,
  Session,
  SessionDomainService,
  SessionPolicy,
  SessionRevokedError,
} from '@nexora/domain-identity';

import { createDatabaseFromPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { PgSessionRepository, PgUserRepository } from '../src/repositories/index.js';
import { ScryptPasswordHasher } from '../src/hasher/index.js';
import { maintenanceUrlOf, resolveTestDatabaseUrl } from './db-isolation.js';

const BASE_URL = resolveTestDatabaseUrl();
const TENANT = 'tenant_auth004' as TenantId;
const ctx = {
  actor: { kind: 'user' as const, id: 'usr_system' },
  correlationId: 'corr_auth004',
  tenantId: TENANT,
};
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

function withDb(name: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function reachable(): Promise<boolean> {
  const pool = new Pool({
    connectionString: maintenanceUrlOf(BASE_URL),
    connectionTimeoutMillis: 1500,
  });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

async function recreate(name: string): Promise<void> {
  const admin = new Pool({ connectionString: maintenanceUrlOf(BASE_URL) });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

async function drop(name: string): Promise<void> {
  const admin = new Pool({ connectionString: maintenanceUrlOf(BASE_URL) });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

const describeDb = (await reachable()) ? describe : describe.skip;

function startSession(token: string, userId = 'usr_auth004'): Session {
  const session = Session.start(
    {
      userId: userId as UserId,
      tenantId: TENANT,
      token,
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    ctx,
  );
  session.pullDomainEvents();
  return session;
}

describeDb('AUTH-004 — session token hashing (PostgreSQL, current schema)', () => {
  const NAME = 'nexora_auth004_schema_test';
  let pool: Pool;
  let repo: PgSessionRepository;

  beforeAll(async () => {
    await recreate(NAME);
    await runMigrations(withDb(NAME));
    pool = new Pool({ connectionString: withDb(NAME) });
    repo = new PgSessionRepository(createDatabaseFromPool(pool));
  });
  afterAll(async () => {
    await pool?.end();
    await drop(NAME);
  });

  it('persists only the SHA-256 digest: the stored value is not the raw token and the raw token is nowhere in the row', async () => {
    const raw = 'raw-cookie-token-for-auth004-0001';
    await repo.save(startSession(raw));
    const { rows } = await pool.query('SELECT * FROM sessions WHERE user_id = $1', ['usr_auth004']);
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row['token_hash']).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(String(row['token_hash'])).toMatch(/^[0-9a-f]{64}$/);
    expect(row['token_hash']).not.toBe(raw);
    expect(Object.keys(row)).not.toContain('token'); // the raw column is gone
    expect(JSON.stringify(row)).not.toContain(raw);
  });

  it('looks a session up by the digest of the presented token; a one-character change or the digest itself finds nothing', async () => {
    const raw = 'raw-cookie-token-for-auth004-0002';
    await repo.save(startSession(raw, 'usr_auth004_b'));
    expect((await repo.findByTokenHash(hashSessionToken(raw)))?.userId).toBe('usr_auth004_b');
    expect(await repo.findByTokenHash(hashSessionToken(`${raw.slice(0, -1)}3`))).toBeUndefined();
    expect(await repo.findByTokenHash(hashSessionToken(hashSessionToken(raw)))).toBeUndefined();
    // The loaded session has no raw token.
    const loaded = await repo.findByTokenHash(hashSessionToken(raw));
    expect(() => loaded?.token).toThrow();
  });

  it('keeps one-session-per-token uniqueness on the digest', async () => {
    const raw = 'raw-cookie-token-for-auth004-0003';
    await repo.save(startSession(raw, 'usr_auth004_c'));
    await expect(
      pool.query(
        `INSERT INTO sessions (id, user_id, tenant_id, token_hash, status, issued_at, expires_at, last_used_at, version)
         VALUES ('ses_dup', 'usr_x', 'tenant_x', $1, 'active', now(), now(), now(), 1)`,
        [hashSessionToken(raw)],
      ),
    ).rejects.toThrow(/sessions_token_hash_unique|duplicate key/);
  });

  it('the lookup uses the unique token_hash index (O(1), not a scan of sessions)', async () => {
    await pool.query('SET enable_seqscan = off');
    const plan = await pool.query(
      `EXPLAIN SELECT * FROM sessions WHERE token_hash = '${hashSessionToken('anything')}'`,
    );
    const text = plan.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
    expect(text).toContain('sessions_token_hash_unique');
    expect(text).not.toMatch(/Seq Scan/);
    await pool.query('RESET enable_seqscan');
  });

  it('the schema has no raw token column or index', async () => {
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions'`,
    );
    const names = cols.rows.map((r: { column_name: string }) => r.column_name);
    expect(names).toContain('token_hash');
    expect(names).not.toContain('token');
    const idx = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'sessions'`);
    expect(idx.rows.map((r: { indexname: string }) => r.indexname)).not.toContain(
      'sessions_token_unique',
    );
  });

  it('end-to-end on Postgres: a started session authenticates by raw token, a flipped token does not, and ending it invalidates it', async () => {
    const users = new PgUserRepository(createDatabaseFromPool(pool));
    const service = new SessionDomainService({
      sessions: repo,
      users,
      hasher: new ScryptPasswordHasher(),
      policy: new SessionPolicy(),
    });
    const raw = 'raw-cookie-token-for-auth004-0004';
    const session = startSession(raw, 'usr_auth004_d');
    await repo.save(session);
    expect((await service.validate(raw)).ok).toBe(true);
    expect((await service.validate(`${raw.slice(0, -1)}9`)).ok).toBe(false);
    await service.end(session.id, ctx);
    const after = await service.validate(raw);
    expect(after.ok).toBe(false);
    // Liveness (AUTH-001/002) still works on the stored session.
    expect(await service.isLive(session.id)).toBe(false);
  });
});

describeDb('AUTH-004 — migration 0025 invalidates existing raw-token sessions (PostgreSQL)', () => {
  const NAME = 'nexora_auth004_migration_test';
  let pool: Pool;

  /** Applies the drizzle SQL files in journal order up to (and excluding) `stopTag`. */
  async function applyUntil(stopTag: string): Promise<string> {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    };
    for (const entry of journal.entries) {
      if (entry.tag === stopTag) return entry.tag;
      const sql = readFileSync(join(MIGRATIONS, `${entry.tag}.sql`), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) {
        if (statement.trim().length > 0) await pool.query(statement);
      }
    }
    throw new Error(`migration ${stopTag} not found`);
  }

  beforeAll(async () => {
    await recreate(NAME);
    pool = new Pool({ connectionString: withDb(NAME) });
  });
  afterAll(async () => {
    await pool?.end();
    await drop(NAME);
  });

  it('ends every active legacy session, drops the raw token, indexes the digest, and accepts new sessions', async () => {
    const tag = await applyUntil('0025_auth004_session_token_hash');
    expect(tag).toBe('0025_auth004_session_token_hash');
    // Pre-migration state: the raw token column exists and holds usable bearer tokens.
    const before = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions'`,
    );
    expect(before.rows.map((r: { column_name: string }) => r.column_name)).toContain('token');
    const insertLegacy = (id: string, token: string, status: string, ended: string | null) =>
      pool.query(
        `INSERT INTO sessions (id, user_id, tenant_id, token, status, issued_at, expires_at, last_used_at, ended_at, version)
         VALUES ($1, 'usr_legacy', 'tnt_platform', $2, $3, now(), now() + interval '8 hours', now(), $4, 1)`,
        [id, token, status, ended],
      );
    await insertLegacy('ses_legacy_live', 'LEGACY-RAW-TOKEN-LIVE-0001', 'active', null);
    await insertLegacy(
      'ses_legacy_ended',
      'LEGACY-RAW-TOKEN-ENDED-0002',
      'ended',
      '2026-08-01T00:00:00Z',
    );

    // Apply migration 0025 itself.
    const sql = readFileSync(join(MIGRATIONS, '0025_auth004_session_token_hash.sql'), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim().length > 0) await pool.query(statement);
    }

    // The raw column is gone; the digest column is NOT NULL, unique-indexed.
    const cols = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'sessions'`,
    );
    const byName = new Map(
      cols.rows.map((r: { column_name: string; is_nullable: string }) => [
        r.column_name,
        r.is_nullable,
      ]),
    );
    expect(byName.has('token')).toBe(false);
    expect(byName.get('token_hash')).toBe('NO');
    const idx = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'sessions'`);
    const names = idx.rows.map((r: { indexname: string }) => r.indexname);
    expect(names).toContain('sessions_token_hash_unique');
    expect(names).not.toContain('sessions_token_unique');

    // Pre-migration sessions are invalidated (the previously-live one is revoked; the ended one stays ended).
    const rows = await pool.query(
      `SELECT id, status, ended_at, token_hash FROM sessions ORDER BY id`,
    );
    const live = rows.rows.find((r: { id: string }) => r.id === 'ses_legacy_live');
    const ended = rows.rows.find((r: { id: string }) => r.id === 'ses_legacy_ended');
    expect(live.status).toBe('revoked');
    expect(live.ended_at).not.toBeNull();
    expect(ended.status).toBe('ended');
    // No stored value equals a legacy raw token.
    for (const r of rows.rows as { token_hash: string }[]) {
      expect(r.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.token_hash).not.toContain('LEGACY-RAW-TOKEN');
    }

    // Through the application: the old RAW cookie no longer authenticates.
    const db = createDatabaseFromPool(pool);
    const repo = new PgSessionRepository(db);
    const service = new SessionDomainService({
      sessions: repo,
      users: new PgUserRepository(db),
      hasher: new ScryptPasswordHasher(),
      policy: new SessionPolicy(),
    });
    const legacy = await service.validate('LEGACY-RAW-TOKEN-LIVE-0001');
    expect(legacy.ok).toBe(false);
    if (!legacy.ok) expect(legacy.error).toBeInstanceOf(SessionRevokedError);
    expect((await service.validate('LEGACY-RAW-TOKEN-ENDED-0002')).ok).toBe(false);

    // A new post-migration session is stored as a digest only, and authenticates.
    const fresh = startSession('POST-MIGRATION-RAW-TOKEN-0003', 'usr_new');
    await repo.save(fresh);
    const stored = await pool.query(`SELECT token_hash FROM sessions WHERE id = $1`, [fresh.id]);
    expect(stored.rows[0].token_hash).toBe(hashSessionToken('POST-MIGRATION-RAW-TOKEN-0003'));
    expect((await service.validate('POST-MIGRATION-RAW-TOKEN-0003')).ok).toBe(true);
  });
});
