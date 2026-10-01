/**
 * Tenant-isolation audit F-001 — business problems on REAL PostgreSQL.
 *
 * `PgBusinessProblemStore.findById` filters by tenant + id only; the
 * detection service layers the workspace scope on top. This exercises the
 * production pairing (service + Pg store) end to end: a problem id from
 * another workspace, or another organization, resolves like a missing one,
 * and a rejected transition leaves the persisted row untouched.
 *
 * Runs only when a PostgreSQL server is reachable (TEST_DATABASE_URL /
 * API_TEST_DATABASE_URL, default localhost:5433), like the other `pg-*` suites.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';
import {
  BusinessSignalRegistry,
  DetectionApplicationService,
  INITIAL_SIGNALS,
  InvestigationEngine,
  SolutionDiscovery,
  type DetectionScope,
  type DetectionSnapshot,
} from '@nexora/module-detection';

import { PgBusinessProblemStore } from '../src/agent/pg-business-problem-store.js';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';
const DB_NAME = 'nexora_problem_scope_pg_test';

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

const ORG_A = 'org_problem_scope_a';
const ORG_B = 'org_problem_scope_b';
const CAPS = ['workflow.retry_run'];

const scopeOf = (tenantId: string, workspaceId: string | undefined): DetectionScope => ({
  userId: 'usr_problem_scope',
  tenantId,
  ...(workspaceId === undefined ? {} : { workspaceId }),
  agentCapabilityIds: CAPS,
});

function failingSnapshot(scope: DetectionScope): DetectionSnapshot {
  return {
    tenantId: scope.tenantId,
    ...(scope.workspaceId === undefined ? {} : { workspaceId: scope.workspaceId }),
    userId: scope.userId,
    generatedAt: '2026-10-01T00:00:00.000Z',
    workflowHealth: [
      {
        definitionKey: 'wf_auth',
        total: 10,
        failed: 6,
        successRate: 40,
        unrecoverableErrorRate: 60,
        cycleTimeP95Ms: null,
      },
    ],
    onboarding: [],
    projects: [],
    notifications: [],
    activity: [],
    agentExecutions: [],
  };
}

describeDb('business problems are tenant + workspace scoped (PostgreSQL)', () => {
  let pool: Pool;
  let db: NexoraDatabase;
  let store: PgBusinessProblemStore;

  const serviceFor = (scope: DetectionScope) => {
    const registry = new BusinessSignalRegistry();
    for (const def of INITIAL_SIGNALS) registry.register(def);
    return new DetectionApplicationService({
      registry,
      snapshotLoader: { load: async () => failingSnapshot(scope) },
      investigation: new InvestigationEngine(),
      discovery: new SolutionDiscovery({
        searchKnowledge: async () => [],
        listExecutions: async () => [],
      }),
      store,
    });
  };

  const detect = async (scope: DetectionScope): Promise<string> => {
    const result = await serviceFor(scope).scan(scope);
    expect(result.ok).toBe(true);
    const problem = result.ok
      ? result.problems.find((p) => p.signalId === 'workflow_failure')
      : undefined;
    expect(problem).toBeDefined();
    return problem?.id as string;
  };

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
    store = new PgBusinessProblemStore(db);
  });

  afterAll(async () => {
    await pool?.end();
    const maintenance = new Pool({ connectionString: MAINTENANCE_URL });
    try {
      await maintenance.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    } finally {
      await maintenance.end();
    }
  });

  it('a problem is readable, re-evaluable and transitionable only in its own tenant + workspace', async () => {
    const wsA = scopeOf(ORG_A, 'wsp_a');
    const wsB = scopeOf(ORG_A, 'wsp_b');
    const orgOnly = scopeOf(ORG_A, undefined);
    const foreignOrg = scopeOf(ORG_B, 'wsp_a');
    const idA = await detect(wsA);
    const idB = await detect(wsB);
    expect(idA).not.toBe(idB);

    const svc = serviceFor(wsA);
    // Control: the owner sees its own problem.
    expect((await svc.getById(wsA, idA))?.id).toBe(idA);
    expect((await svc.reevaluate(wsA, idA))?.problem.id).toBe(idA);

    // Same org, other workspace / org-level scope / other org: nothing.
    for (const foreign of [wsB, orgOnly, foreignOrg]) {
      expect(await svc.getById(foreign, idA)).toBeUndefined();
      expect(await svc.reevaluate(foreign, idA)).toBeUndefined();
      expect(await svc.listByIds(foreign, [idA])).toEqual([]);
    }

    // A rejected transition leaves the persisted row exactly as it was.
    const before = await store.findById(ORG_A, idA);
    for (const foreign of [wsB, orgOnly, foreignOrg]) {
      expect(await svc.transition(foreign, idA, 'RESOLVED', '2026-10-01T01:00:00.000Z')).toBe(
        false,
      );
    }
    expect(await store.findById(ORG_A, idA)).toEqual(before);

    // Control: the owning workspace can transition it.
    expect(await svc.transition(wsA, idA, 'INVESTIGATING', '2026-10-01T01:00:00.000Z')).toBe(true);
    expect((await store.findById(ORG_A, idA))?.status).toBe('INVESTIGATING');
    // …and the other workspace's problem was never touched.
    expect((await store.findById(ORG_A, idB))?.status).toBe('DETECTED');
  });
});
