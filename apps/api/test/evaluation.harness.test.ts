/**
 * The scenario harness, seeder, runner determinism, and the Postgres reset
 * plan (no database needed except the gated round-trip at the bottom).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';
import {
  buildBaseWorld,
  buildDatasetV1,
  evaluateScenario,
  WorldIndex,
  type ScenarioDefinition,
} from '@nexora/evaluation';
import type { TenantId } from '@nexora/contracts/common';

import { createScenarioApp } from '../evaluation/harness.js';
import {
  planScenarioReset,
  resetScenarioData,
  scenarioScope,
  schemaTables,
  seedScenarioDataset,
} from '../evaluation/postgres.js';
import { observeScenario, resolvePlaceholders } from '../evaluation/runner.js';
import { seedWorld } from '../evaluation/seed-world.js';

describe('scenario harness', () => {
  it('seeds the world and logs every user in through the real OIDC callback', async () => {
    const world = buildBaseWorld();
    const harness = await createScenarioApp(world);
    try {
      expect(harness.seed.counts).toMatchObject({
        organization: 2,
        workspace: 6,
        user: 7,
        project: 4,
      });
      for (const user of world.users) {
        const me = await harness.request(user.key, 'GET', '/api/me');
        expect(me.statusCode, user.key).toBe(200);
        expect((me.json() as { user: { id: string } }).user.id).toBe(user.id);
      }
    } finally {
      await harness.close();
    }
  });

  it('resolves every declared business role through GET /api/role-context', async () => {
    const world = buildBaseWorld();
    const index = new WorldIndex(world);
    const harness = await createScenarioApp(world);
    try {
      for (const membership of world.workspaceMemberships) {
        const response = await harness.request(membership.user, 'GET', '/api/role-context');
        const options = (response.json() as { options: { workspaceId: string; roleId: string }[] })
          .options;
        const option = options.find(
          (o) => o.workspaceId === index.workspace(membership.workspace).id,
        );
        expect(option?.roleId, `${membership.user}@${membership.workspace}`).toBe(
          membership.expectedRole,
        );
      }
    } finally {
      await harness.close();
    }
  });

  it('seeding is idempotent (deterministic ids → upserts)', async () => {
    const world = buildBaseWorld();
    const harness = await createScenarioApp(world);
    try {
      const tenant = new WorldIndex(world).organization('aurora').id as TenantId;
      const before = (await harness.repos.projects.listByOrganization(tenant)).length;
      await seedWorld(harness.repos, world);
      await seedWorld(harness.repos, world);
      expect((await harness.repos.projects.listByOrganization(tenant)).length).toBe(before);
      expect((await harness.repos.employees.listByOrganization(tenant)).length).toBe(3);
    } finally {
      await harness.close();
    }
  });

  it('never seeds notifications/activity as a side effect (no domain events published)', async () => {
    const world = buildBaseWorld();
    const harness = await createScenarioApp(world);
    try {
      const response = await harness.request('meera', 'GET', `/api/notifications/unread-count`);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ count: 0 });
    } finally {
      await harness.close();
    }
  });
});

describe('scenario runner', () => {
  const dataset = buildDatasetV1();
  const scenario = (id: string) => dataset.scenarios.find((s) => s.id === id) as ScenarioDefinition;

  it('is deterministic: the same scenario yields the same evaluation', async () => {
    const first = evaluateScenario(scenario('NXS-003'), await observeScenario(scenario('NXS-003')));
    const second = evaluateScenario(
      scenario('NXS-003'),
      await observeScenario(scenario('NXS-003')),
    );
    const strip = (r: typeof first) => ({
      ...r,
      latency: null,
      observed: { ...r.observed, timings: [], approvals: [] },
    });
    expect(strip(second)).toEqual(strip(first));
    expect(first.status).toBe('passed');
  }, 60_000);

  it('turns fixture drift (a role that no longer resolves) into a scenario error, never a pass', async () => {
    const drifted: ScenarioDefinition = {
      ...scenario('NXS-003'),
      world: {
        ...scenario('NXS-003').world,
        workspaceMemberships: scenario('NXS-003').world.workspaceMemberships.map((m) =>
          m.user === 'meera' && m.workspace === 'aurora-exec'
            ? { ...m, expectedRole: 'finance.cfo' }
            : m,
        ),
      },
    };
    const observation = await observeScenario(drifted);
    expect(observation.errors.join(' ')).toContain(
      'resolved role executive.ceo, expected finance.cfo',
    );
    expect(evaluateScenario(drifted, observation).status).toBe('error');
  }, 60_000);

  it('resolves request placeholders from the world (never literal ids)', () => {
    const index = new WorldIndex(buildBaseWorld());
    expect(
      resolvePlaceholders(
        index,
        '/api/projects?organizationId={org:borealis}&workspaceId={ws:borealis-ops}',
      ),
    ).toBe(
      `/api/projects?organizationId=${index.organization('borealis').id}&workspaceId=${index.workspace('borealis-ops').id}`,
    );
    expect(() => resolvePlaceholders(index, '{org:nowhere}')).toThrow('Unknown organization');
  });
});

describe('scenario reset plan (PostgreSQL)', () => {
  it('scopes every table in the persistence schema', () => {
    const plan = planScenarioReset();
    expect(plan.map((rule) => rule.table).sort()).toEqual(
      schemaTables()
        .map((t) => getTableName(t))
        .sort(),
    );
    const byTable = Object.fromEntries(plan.map((rule) => [rule.table, rule.by]));
    expect(byTable['organizations']).toEqual(['id:organization']);
    expect(byTable['users']).toEqual(['id:user']);
    expect(byTable['sessions']).toContain('userId');
    expect(byTable['remediation_plan_steps']).toContain('planId');
  });

  it('clears plan-scoped children before their plans', () => {
    const plan = planScenarioReset().map((rule) => rule.table);
    expect(plan.indexOf('remediation_plan_steps')).toBeLessThan(plan.indexOf('remediation_plans'));
  });

  it('refuses a table it cannot scope (a new table can never escape reset)', () => {
    const mystery = pgTable('mystery_table', { id: text('id').primaryKey(), label: text('label') });
    expect(() => planScenarioReset([...schemaTables(), mystery])).toThrow(
      'Scoped reset cannot scope table(s) mystery_table',
    );
  });

  it('owns only deterministic, dataset-namespaced ids', () => {
    const scope = scenarioScope(buildDatasetV1());
    expect(scope.organizationIds).toHaveLength(2);
    for (const id of scope.organizationIds) expect(id).toMatch(/^org_[0-9a-f-]{36}$/);
    for (const id of scope.userIds) expect(id).toMatch(/^usr_[0-9a-f-]{36}$/);
  });
});

// ---------------------------------------------------------------------------
// Gated PostgreSQL round-trip (skips when no database is reachable, like the
// other pg suites). Uses its own database so it never touches dev data.
// ---------------------------------------------------------------------------

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';

function withDatabase(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

const SCENARIO_DB_URL = withDatabase(BASE_URL, 'nexora_scenarios_test');
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

describeDb('scenario seed/reset against PostgreSQL', () => {
  let pool: Pool;
  let db: NexoraDatabase;

  beforeAll(async () => {
    const maintenance = new Pool({ connectionString: MAINTENANCE_URL });
    try {
      await maintenance.query('DROP DATABASE IF EXISTS "nexora_scenarios_test" WITH (FORCE)');
      await maintenance.query('CREATE DATABASE "nexora_scenarios_test"');
    } finally {
      await maintenance.end();
    }
    await runMigrations(SCENARIO_DB_URL);
    pool = new Pool({ connectionString: SCENARIO_DB_URL });
    db = createDatabaseFromPool(pool);
  });

  afterAll(async () => {
    await pool?.end();
    const maintenance = new Pool({ connectionString: MAINTENANCE_URL });
    try {
      await maintenance.query('DROP DATABASE IF EXISTS "nexora_scenarios_test" WITH (FORCE)');
    } finally {
      await maintenance.end();
    }
  });

  it('seeds idempotently, resets exactly the dataset rows, and reseeds', async () => {
    const dataset = buildDatasetV1();
    const scope = scenarioScope(dataset);
    const count = async (table: string) =>
      Number((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n ?? 0);

    // A foreign row that reset must never touch.
    await pool.query(
      `INSERT INTO projects (id, organization_id, name, status, created_at, updated_at, version)
       VALUES ('prj_foreign', 'org_foreign', 'Foreign', 'active', now(), now(), 1)`,
    );

    await seedScenarioDataset(db, dataset);
    const seeded = { projects: await count('projects'), users: await count('users') };
    await seedScenarioDataset(db, dataset);
    expect({ projects: await count('projects'), users: await count('users') }).toEqual(seeded);
    expect(seeded.users).toBe(scope.userIds.length);

    const deleted = await resetScenarioData(db, scope);
    expect(deleted['organizations']).toBe(2);
    expect(await count('users')).toBe(0);
    expect(await count('projects')).toBe(1); // only the foreign row survives

    await seedScenarioDataset(db, dataset);
    expect(await count('projects')).toBe(seeded.projects);
  }, 60_000);

  it('keeps ids deterministic, rows unique, relationships valid, and every table scoped on reset', async () => {
    const dataset = buildDatasetV1();
    const scope = scenarioScope(dataset);
    const organizations = new Set(scope.organizationIds);
    const workspaces = new Set(scope.workspaceIds);
    const users = new Set(scope.userIds);

    // Every schema table with an `id` column, by SQL name, plus its scope columns.
    const tables = schemaTables().map((table) => {
      const columns = Object.values(getTableColumns(table)).map((column) => column.name);
      return { name: getTableName(table), columns: new Set(columns) };
    });
    const scopeColumns = ['organization_id', 'tenant_id', 'workspace_id', 'user_id'] as const;

    /** The ids of the dataset-owned rows of every table (sorted), keyed by table. */
    const ownedIds = async (): Promise<Record<string, string[]>> => {
      const out: Record<string, string[]> = {};
      for (const table of tables) {
        if (!table.columns.has('id')) continue;
        const clauses: string[] = [];
        const params: string[][] = [];
        const add = (column: string, ids: readonly string[]) => {
          params.push([...ids]);
          clauses.push(`${column} = ANY($${params.length})`);
        };
        if (table.name === 'organizations') add('id', scope.organizationIds);
        else if (table.name === 'users') add('id', scope.userIds);
        else {
          if (table.columns.has('organization_id')) add('organization_id', scope.organizationIds);
          if (table.columns.has('tenant_id')) add('tenant_id', scope.organizationIds);
          if (table.columns.has('workspace_id')) add('workspace_id', scope.workspaceIds);
          if (table.columns.has('user_id')) add('user_id', scope.userIds);
        }
        if (clauses.length === 0) continue;
        const { rows } = await pool.query<{ id: string }>(
          `SELECT id::text AS id FROM ${table.name} WHERE ${clauses.join(' OR ')} ORDER BY id`,
          params,
        );
        out[table.name] = rows.map((row) => row.id);
      }
      return out;
    };

    // Foreign rows in several tables (non-scenario data that must survive).
    await pool.query(
      `INSERT INTO organizations (id, slug, type, status, profile, settings, created_at, updated_at, version)
       VALUES ('org_keepme', 'keep-me', 'startup', 'active', '{}', '{}', now(), now(), 1)
       ON CONFLICT DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO projects (id, organization_id, name, status, created_at, updated_at, version)
       VALUES ('prj_keepme', 'org_keepme', 'Keep Me Project', 'active', now(), now(), 1)
       ON CONFLICT DO NOTHING`,
    );
    const foreignBefore = {
      organizations: await pool.query(`SELECT id FROM organizations WHERE id = 'org_keepme'`),
      projects: await pool.query(`SELECT id FROM projects WHERE id = 'prj_keepme'`),
    };
    expect(foreignBefore.organizations.rowCount).toBe(1);

    await resetScenarioData(db, scope);
    await seedScenarioDataset(db, dataset);
    const first = await ownedIds();
    await seedScenarioDataset(db, dataset);
    const second = await ownedIds();

    // Idempotent seed: the same rows, no duplicates.
    expect(second).toEqual(first);
    for (const [table, ids] of Object.entries(first)) {
      expect(new Set(ids).size, `${table} has duplicate ids`).toBe(ids.length);
    }
    expect(first['organizations']).toEqual([...scope.organizationIds].sort());
    expect(first['users']).toEqual([...scope.userIds].sort());
    expect(first['workspaces']).toEqual([...scope.workspaceIds].sort());

    // Relationships: every dataset-owned row points at rows that exist.
    for (const table of tables) {
      for (const column of scopeColumns) {
        if (!table.columns.has(column) || table.name === 'users') continue;
        const target =
          column === 'workspace_id'
            ? { set: workspaces, table: 'workspaces' }
            : column === 'user_id'
              ? { set: users, table: 'users' }
              : { set: organizations, table: 'organizations' };
        const { rows } = await pool.query<{ ref: string }>(
          `SELECT DISTINCT ${column}::text AS ref FROM ${table.name}
           WHERE ${column}::text = ANY($1)
             AND ${column}::text NOT IN (SELECT id::text FROM ${target.table})`,
          [[...target.set]],
        );
        expect(rows, `${table.name}.${column} → ${target.table}`).toEqual([]);
      }
    }
    // Memberships reference only dataset organizations/workspaces and users.
    const orphanMembers = await pool.query(
      `SELECT m.id FROM workspace_memberships m
       LEFT JOIN workspaces w ON w.id = m.workspace_id
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ANY($1) AND (w.id IS NULL OR u.id IS NULL)`,
      [[...scope.workspaceIds]],
    );
    expect(orphanMembers.rows).toEqual([]);

    // Reset: EVERY table loses every dataset-owned row …
    await resetScenarioData(db, scope);
    const afterReset = await ownedIds();
    for (const [table, ids] of Object.entries(afterReset)) {
      expect(ids, `${table} still holds dataset rows after reset`).toEqual([]);
    }
    // … and only those: the foreign rows are intact.
    expect(
      (await pool.query(`SELECT id FROM organizations WHERE id = 'org_keepme'`)).rowCount,
    ).toBe(1);
    expect((await pool.query(`SELECT id FROM projects WHERE id = 'prj_keepme'`)).rowCount).toBe(1);

    // Reseed: exactly the same deterministic ids as the first seed.
    await seedScenarioDataset(db, dataset);
    expect(await ownedIds()).toEqual(first);
  }, 120_000);
});
