/**
 * AUTH-009 on real PostgreSQL: users carry an optional external OIDC identity
 * (issuer + subject) with a PARTIAL composite unique index; binding is one
 * atomic first-wins conditional UPDATE; migration 0026 leaves every existing
 * user and session untouched.
 *
 * Throwaway databases; skips cleanly when Postgres is unreachable.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { TenantId, UserId } from '@nexora/contracts/common';
import {
  DisplayName,
  Email,
  PasswordHash,
  User,
  UserStatus,
  Username,
} from '@nexora/domain-identity';

import { createDatabaseFromPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { PgUserRepository } from '../src/repositories/index.js';
import { maintenanceUrlOf, resolveTestDatabaseUrl } from './db-isolation.js';

const BASE_URL = resolveTestDatabaseUrl();
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const TENANT = 'tnt_platform' as TenantId;
const ISSUER = 'http://localhost:8080/realms/nexora';
const ctx = { actor: { kind: 'user' as const, id: 'sys' }, correlationId: 'c', tenantId: TENANT };

const withDb = (name: string): string => {
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
};
async function admin<T>(work: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({
    connectionString: maintenanceUrlOf(BASE_URL),
    connectionTimeoutMillis: 3000,
  });
  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
}
const reachable = await admin((p) => p.query('SELECT 1')).then(
  () => true,
  () => false,
);
const describeDb = reachable ? describe : describe.skip;
const recreate = (name: string) =>
  admin(async (p) => {
    await p.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await p.query(`CREATE DATABASE "${name}"`);
  });
const drop = (name: string) =>
  admin((p) => p.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));

function newUser(email: string, binding?: { issuer: string; subject: string }): User {
  const user = User.create(
    {
      tenantId: TENANT,
      email: Email.create(email),
      username: Username.create(email.split('@')[0]!.replace(/[^a-z0-9._-]/g, '')),
      passwordHash: PasswordHash.create('scrypt', 'oidc-unusable'),
      displayName: DisplayName.create('Test User'),
      status: UserStatus.active(),
      ...(binding === undefined
        ? {}
        : { oidcIssuer: binding.issuer, oidcSubject: binding.subject }),
    },
    ctx,
  );
  user.pullDomainEvents();
  return user;
}

describeDb('AUTH-009 — identity binding (PostgreSQL, current schema)', () => {
  const NAME = 'nexora_auth009_schema_test';
  let pool: Pool;
  let repo: PgUserRepository;
  const row = async (id: string) =>
    (await pool.query('SELECT oidc_issuer, oidc_subject FROM users WHERE id = $1', [id]))
      .rows[0] as {
      oidc_issuer: string | null;
      oidc_subject: string | null;
    };

  beforeAll(async () => {
    await recreate(NAME);
    await runMigrations(withDb(NAME));
    pool = new Pool({ connectionString: withDb(NAME) });
    repo = new PgUserRepository(createDatabaseFromPool(pool));
  });
  afterAll(async () => {
    await pool?.end();
    await drop(NAME);
  });

  it('a user created bound stores issuer + subject in the insert; lookup is an exact (issuer, subject) match with no email fallback', async () => {
    const user = newUser('bound@nexora.dev', { issuer: ISSUER, subject: 'sub-bound' });
    await repo.save(user);
    expect(await row(user.id)).toEqual({ oidc_issuer: ISSUER, oidc_subject: 'sub-bound' });
    expect((await repo.findByOidcIdentity(ISSUER, 'sub-bound'))?.id).toBe(user.id);
    expect(await repo.findByOidcIdentity(ISSUER, 'sub-other')).toBeUndefined(); // subject differs
    expect(await repo.findByOidcIdentity('https://other.example', 'sub-bound')).toBeUndefined(); // issuer differs
    // The email is irrelevant to this lookup.
    expect(await repo.findByOidcIdentity(ISSUER, 'bound@nexora.dev')).toBeUndefined();
    const loaded = await repo.findByOidcIdentity(ISSUER, 'sub-bound');
    expect([loaded?.oidcIssuer, loaded?.oidcSubject]).toEqual([ISSUER, 'sub-bound']);
  });

  it('the composite unique index forbids a duplicate (issuer, subject) but allows many unbound (NULL) users', async () => {
    await repo.save(newUser('dup-a@nexora.dev', { issuer: ISSUER, subject: 'sub-dup' }));
    await expect(
      repo.save(newUser('dup-b@nexora.dev', { issuer: ISSUER, subject: 'sub-dup' })),
    ).rejects.toThrow();
    // Same subject under another issuer, and another subject under the same issuer, are fine.
    await repo.save(
      newUser('dup-c@nexora.dev', { issuer: 'https://other.example', subject: 'sub-dup' }),
    );
    await repo.save(newUser('dup-d@nexora.dev', { issuer: ISSUER, subject: 'sub-dup-2' }));
    // Any number of unbound users coexist.
    for (const n of [1, 2, 3, 4]) await repo.save(newUser(`unbound-${n}@nexora.dev`));
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM users WHERE email LIKE 'unbound-%' AND oidc_issuer IS NULL AND oidc_subject IS NULL`,
    );
    expect(rows[0].n).toBe(4);
  });

  it('binds an UNBOUND user once (first wins) and never overwrites an existing binding', async () => {
    const user = newUser('legacy@nexora.dev');
    await repo.save(user);
    expect(await row(user.id)).toEqual({ oidc_issuer: null, oidc_subject: null });
    expect(await repo.bindOidcIdentity(user.id, ISSUER, 'sub-first')).toBe(true);
    expect(await row(user.id)).toEqual({ oidc_issuer: ISSUER, oidc_subject: 'sub-first' });
    // A second, different identity cannot replace it; the same identity cannot be re-bound either.
    expect(await repo.bindOidcIdentity(user.id, ISSUER, 'sub-second')).toBe(false);
    expect(await repo.bindOidcIdentity(user.id, 'https://other.example', 'sub-first')).toBe(false);
    expect(await repo.bindOidcIdentity(user.id, ISSUER, 'sub-first')).toBe(false);
    expect(await row(user.id)).toEqual({ oidc_issuer: ISSUER, oidc_subject: 'sub-first' });
    // An unknown user id binds nothing.
    expect(await repo.bindOidcIdentity('usr_missing' as UserId, ISSUER, 'sub-ghost')).toBe(false);
  });

  it('an identity already bound to another account cannot be bound to a second one', async () => {
    const owner = newUser('owner@nexora.dev', { issuer: ISSUER, subject: 'sub-owned' });
    const other = newUser('other-acct@nexora.dev');
    await repo.save(owner);
    await repo.save(other);
    expect(await repo.bindOidcIdentity(other.id, ISSUER, 'sub-owned')).toBe(false);
    expect(await row(other.id)).toEqual({ oidc_issuer: null, oidc_subject: null });
  });

  it('RACE: many concurrent first logins for one unbound user with different subjects → exactly one binding wins', async () => {
    const user = newUser('race@nexora.dev');
    await repo.save(user);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => repo.bindOidcIdentity(user.id, ISSUER, `sub-race-${i}`)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const final = await row(user.id);
    const winner = results.findIndex(Boolean);
    expect(final).toEqual({ oidc_issuer: ISSUER, oidc_subject: `sub-race-${winner}` });
    // The same identity racing against itself: one UPDATE wins, the rest are no-ops, the account stays bound to it.
    const same = newUser('race-same@nexora.dev');
    await repo.save(same);
    const sameResults = await Promise.all(
      Array.from({ length: 6 }, () => repo.bindOidcIdentity(same.id, ISSUER, 'sub-race-same')),
    );
    expect(sameResults.filter(Boolean)).toHaveLength(1);
    expect((await repo.findByOidcIdentity(ISSUER, 'sub-race-same'))?.id).toBe(same.id);
  });

  it('RACE: concurrent binds of ONE identity to different accounts → the unique index admits exactly one', async () => {
    const users = [
      newUser('rc-1@nexora.dev'),
      newUser('rc-2@nexora.dev'),
      newUser('rc-3@nexora.dev'),
    ];
    for (const u of users) await repo.save(u);
    const results = await Promise.all(
      users.map((u) => repo.bindOidcIdentity(u.id, ISSUER, 'sub-contended')),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM users WHERE oidc_subject = 'sub-contended'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('a later save() of a stale aggregate (loaded before the bind) never clears or changes the binding', async () => {
    const user = newUser('stale@nexora.dev');
    await repo.save(user);
    const stale = (await repo.findById(user.id))!; // unbound snapshot
    expect(await repo.bindOidcIdentity(user.id, ISSUER, 'sub-stale')).toBe(true);
    await repo.save(stale); // e.g. a profile/status update from an older read
    expect(await row(user.id)).toEqual({ oidc_issuer: ISSUER, oidc_subject: 'sub-stale' });
  });

  it('the identity lookup uses the composite partial unique index (not a scan of users)', async () => {
    await pool.query('SET enable_seqscan = off');
    const plan = await pool.query(
      `EXPLAIN SELECT * FROM users WHERE oidc_issuer = '${ISSUER}' AND oidc_subject = 'sub-x'`,
    );
    const text = plan.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
    expect(text).toContain('users_oidc_identity_unique');
    expect(text).not.toMatch(/Seq Scan/);
    await pool.query('RESET enable_seqscan');
  });
});

describeDb(
  'AUTH-009 — migration 0026 leaves existing users and sessions untouched (PostgreSQL)',
  () => {
    const NAME = 'nexora_auth009_migration_test';
    let pool: Pool;

    const runSql = async (sql: string): Promise<void> => {
      for (const statement of sql.split('--> statement-breakpoint')) {
        if (statement.trim().length > 0) await pool.query(statement);
      }
    };
    async function applyUntil(stopTag: string): Promise<void> {
      const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
        entries: { tag: string }[];
      };
      for (const entry of journal.entries) {
        if (entry.tag === stopTag) return;
        await runSql(readFileSync(join(MIGRATIONS, `${entry.tag}.sql`), 'utf8'));
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

    it('adds nullable columns and the partial unique index; legacy users stay unbound and unchanged; sessions are untouched; duplicates are rejected', async () => {
      await applyUntil('0026_auth009_oidc_identity_binding');
      const before = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
      );
      expect(before.rows.map((r: { column_name: string }) => r.column_name)).not.toContain(
        'oidc_issuer',
      );

      const insertUser = (id: string, email: string) =>
        pool.query(
          `INSERT INTO users (id, tenant_id, email, username, password_algorithm, password_hash, status, profile, roles, created_at, updated_at, version)
         VALUES ($1, 'tnt_platform', $2, $3, 'scrypt', 'x', 'active', '{"displayName":"L","updatedAt":"2026-01-01T00:00:00.000Z"}', '[]', now(), now(), 1)`,
          [id, email, id],
        );
      await insertUser('usr_legacy_1', 'legacy1@nexora.dev');
      await insertUser('usr_legacy_2', 'legacy2@nexora.dev');
      await pool.query(
        `INSERT INTO sessions (id, user_id, tenant_id, token_hash, status, issued_at, expires_at, last_used_at, version)
       VALUES ('ses_legacy', 'usr_legacy_1', 'tnt_platform', repeat('a', 64), 'active', now(), now() + interval '8 hours', now(), 1)`,
      );
      const snapshot = async () => ({
        users: (
          await pool.query(
            `SELECT to_jsonb(u) - 'oidc_issuer' - 'oidc_subject' AS j FROM users u ORDER BY id`,
          )
        ).rows,
        sessions: (await pool.query(`SELECT to_jsonb(s) AS j FROM sessions s ORDER BY id`)).rows,
      });
      const legacyBefore = await snapshot();

      await runSql(
        readFileSync(join(MIGRATIONS, '0026_auth009_oidc_identity_binding.sql'), 'utf8'),
      );

      // New columns: present, nullable.
      const cols = await pool.query(
        `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'users' AND column_name LIKE 'oidc_%'`,
      );
      expect(
        Object.fromEntries(
          cols.rows.map((r: { column_name: string; is_nullable: string }) => [
            r.column_name,
            r.is_nullable,
          ]),
        ),
      ).toEqual({
        oidc_issuer: 'YES',
        oidc_subject: 'YES',
      });
      // Partial unique index on the pair.
      const idx = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'users_oidc_identity_unique'`,
      );
      expect(idx.rows).toHaveLength(1);
      expect(idx.rows[0].indexdef).toMatch(/UNIQUE/i);
      expect(idx.rows[0].indexdef).toMatch(/oidc_issuer, oidc_subject/);
      expect(idx.rows[0].indexdef).toMatch(
        /WHERE.*oidc_issuer IS NOT NULL.*oidc_subject IS NOT NULL/s,
      );
      // Existing email uniqueness is intact.
      const emailIdx = await pool.query(
        `SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_unique'`,
      );
      expect(emailIdx.rows).toHaveLength(1);

      // Legacy users: unbound (NOT backfilled) and otherwise byte-identical; sessions untouched.
      const unbound = await pool.query(
        `SELECT id, oidc_issuer, oidc_subject FROM users ORDER BY id`,
      );
      expect(unbound.rows).toEqual([
        { id: 'usr_legacy_1', oidc_issuer: null, oidc_subject: null },
        { id: 'usr_legacy_2', oidc_issuer: null, oidc_subject: null },
      ]);
      expect(await snapshot()).toEqual(legacyBefore);

      // Post-migration behaviour: bound users, duplicates rejected, unbound coexist.
      await pool.query(
        `UPDATE users SET oidc_issuer = 'i', oidc_subject = 's' WHERE id = 'usr_legacy_1'`,
      );
      await expect(
        pool.query(
          `UPDATE users SET oidc_issuer = 'i', oidc_subject = 's' WHERE id = 'usr_legacy_2'`,
        ),
      ).rejects.toThrow(/users_oidc_identity_unique|duplicate key/);
      await insertUser('usr_new_unbound', 'new@nexora.dev'); // another unbound user is fine
      expect(
        (await pool.query(`SELECT count(*)::int AS n FROM users WHERE oidc_issuer IS NULL`)).rows[0]
          .n,
      ).toBe(2);
      // The existing session still points at a valid, active session row.
      expect(
        (await pool.query(`SELECT status FROM sessions WHERE id = 'ses_legacy'`)).rows[0].status,
      ).toBe('active');
    });
  },
);
