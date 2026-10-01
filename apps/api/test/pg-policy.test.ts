/**
 * Prompt 5 — policy configuration + approval-policy persistence (PostgreSQL).
 *
 * Runs against a THROWAWAY database created from the repo migrations (so the
 * 0020 migration itself is exercised) and skips cleanly when Postgres is
 * unreachable. Verifies:
 * - policy configuration is append-only and versioned per (organization,
 *   policy): `current` is the highest version, history keeps every version,
 *   and the unique index refuses a duplicate version;
 * - concurrent appends both succeed with distinct versions (no lost update);
 * - configuration is tenant-scoped: one organization never reads another's;
 * - the ApiPolicyPort applies ONLY the caller organization's configuration
 *   (persisted, so it survives a fresh repository instance);
 * - an approval's recorded policy decision round-trips through the durable
 *   approval engine unchanged (history is recorded, never recomputed).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';

import { PgApprovalEngine } from '../src/ai/pg-approval-engine.js';
import { ApiPolicyPort } from '../src/policy/api-policy-port.js';
import {
  PgPolicySettingsRepository,
  PolicyVersionConflictError,
} from '../src/policy/policy-settings.js';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';
const DB_NAME = 'nexora_policy_pg_test';

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

const ORG_A = 'org_pg_policy_a';
const ORG_B = 'org_pg_policy_b';
const LIMIT = 'POLICY_FINANCE_BUDGET_LIMIT';

describeDb('policy persistence (PostgreSQL)', () => {
  let pool: Pool;
  let db: NexoraDatabase;
  let settings: PgPolicySettingsRepository;

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
    settings = new PgPolicySettingsRepository(db);
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

  it('appends versions: current is the highest, history keeps every version, nothing is rewritten', async () => {
    expect(await settings.current(ORG_A, LIMIT)).toBeUndefined();
    const v1 = await settings.append({
      organizationId: ORG_A,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'usr_admin',
    });
    const v2 = await settings.append({
      organizationId: ORG_A,
      policyId: LIMIT,
      config: { mode: 'require_approval' },
      createdBy: 'usr_admin',
    });
    expect([v1.version, v2.version]).toEqual([1, 2]);

    expect((await settings.current(ORG_A, LIMIT))?.config).toEqual({ mode: 'require_approval' });
    const history = await settings.history(ORG_A, LIMIT);
    expect(history.map((r) => [r.version, r.config])).toEqual([
      [1, { mode: 'deny' }],
      [2, { mode: 'require_approval' }],
    ]);
    // Version 1 is exactly as it was written.
    expect(history[0]).toMatchObject({ createdBy: 'usr_admin', policyId: LIMIT });
  });

  it('the unique (organization, policy, version) index refuses a duplicate version', async () => {
    await expect(
      pool.query(
        `INSERT INTO policy_settings (id, organization_id, policy_id, version, config, created_by, created_at)
         VALUES ('pol_dup', $1, $2, 1, '{}'::jsonb, 'usr_x', now())`,
        [ORG_A, LIMIT],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
    expect((await settings.history(ORG_A, LIMIT)).length).toBe(2);
  });

  it('concurrent appends both succeed with distinct versions (no lost update)', async () => {
    const [a, b] = await Promise.all([
      settings.append({
        organizationId: ORG_B,
        policyId: LIMIT,
        config: { mode: 'deny' },
        createdBy: 'usr_1',
      }),
      settings.append({
        organizationId: ORG_B,
        policyId: LIMIT,
        config: { mode: 'require_approval' },
        createdBy: 'usr_2',
      }),
    ]);
    expect(new Set([a.version, b.version]).size).toBe(2);
    expect((await settings.history(ORG_B, LIMIT)).map((r) => r.version)).toEqual([1, 2]);
  });

  it('configuration is tenant-scoped', async () => {
    const other = 'org_pg_policy_c';
    expect(await settings.current(other, LIMIT)).toBeUndefined();
    expect(await settings.history(other, LIMIT)).toEqual([]);
    expect((await settings.current(ORG_A, LIMIT))?.organizationId).toBe(ORG_A);
  });

  it('append stores enabled / reason / change type / config hash; a disable is a NEW version', async () => {
    const org = 'org_pg_policy_d';
    const created = await settings.append({
      organizationId: org,
      policyId: LIMIT,
      config: { mode: 'deny' },
      reason: 'initial',
      createdBy: 'usr_admin',
    });
    expect(created).toMatchObject({ version: 1, enabled: true, changeType: 'created' });
    expect(created.configHash).toMatch(/^[0-9a-f]{64}$/);
    const disabled = await settings.append({
      organizationId: org,
      policyId: LIMIT,
      config: { mode: 'deny' },
      enabled: false,
      changeType: 'disabled',
      createdBy: 'usr_admin',
    });
    expect(disabled).toMatchObject({ version: 2, enabled: false, changeType: 'disabled' });
    // Same configuration => same hash; the earlier row is untouched.
    expect(disabled.configHash).toBe(created.configHash);
    expect(await settings.get(org, LIMIT, 1)).toMatchObject({
      enabled: true,
      reason: 'initial',
      changeType: 'created',
    });
    expect((await settings.current(org, LIMIT))?.enabled).toBe(false);
    expect(await settings.get(org, LIMIT, 9)).toBeUndefined();
    expect(await settings.get('org_pg_policy_c', LIMIT, 1)).toBeUndefined();
  });

  it('listCurrent returns the latest version of each policy of ONE organization', async () => {
    const org = 'org_pg_policy_e';
    await settings.append({
      organizationId: org,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'usr_1',
    });
    await settings.append({
      organizationId: org,
      policyId: LIMIT,
      config: { mode: 'require_approval' },
      createdBy: 'usr_1',
    });
    await settings.append({
      organizationId: org,
      policyId: 'POLICY_APPROVAL_AUTHORITY',
      config: { rules: [] },
      createdBy: 'usr_1',
    });
    const current = await settings.listCurrent(org);
    expect(current.map((r) => [r.policyId, r.version])).toEqual([
      ['POLICY_APPROVAL_AUTHORITY', 1],
      [LIMIT, 2],
    ]);
    expect(await settings.listCurrent('org_pg_policy_nobody')).toEqual([]);
    expect((await settings.listCurrent(ORG_A)).every((r) => r.organizationId === ORG_A)).toBe(true);
  });

  it('expectedVersion mismatch raises a conflict and writes nothing', async () => {
    const org = 'org_pg_policy_f';
    await expect(
      settings.append({
        organizationId: org,
        policyId: LIMIT,
        config: { mode: 'deny' },
        createdBy: 'usr_1',
        expectedVersion: 3,
      }),
    ).rejects.toBeInstanceOf(PolicyVersionConflictError);
    expect(await settings.history(org, LIMIT)).toEqual([]);
    await settings.append({
      organizationId: org,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'usr_1',
      expectedVersion: 0,
    });
    await expect(
      settings.append({
        organizationId: org,
        policyId: LIMIT,
        config: { mode: 'require_approval' },
        createdBy: 'usr_1',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'POLICY_VERSION_CONFLICT', currentVersion: 1 });
    expect((await settings.history(org, LIMIT)).length).toBe(1);
  });

  it('concurrent appends with the SAME expectedVersion: exactly one wins, the other conflicts', async () => {
    const org = 'org_pg_policy_g';
    const results = await Promise.allSettled([
      settings.append({
        organizationId: org,
        policyId: LIMIT,
        config: { mode: 'deny' },
        createdBy: 'usr_1',
        expectedVersion: 0,
      }),
      settings.append({
        organizationId: org,
        policyId: LIMIT,
        config: { mode: 'require_approval' },
        createdBy: 'usr_2',
        expectedVersion: 0,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(PolicyVersionConflictError);
    expect((await settings.history(org, LIMIT)).length).toBe(1);
  });

  it('non-unique errors are NOT retried (they propagate)', async () => {
    // A value the varchar(500) reason column rejects is a non-23505 failure.
    await expect(
      settings.append({
        organizationId: 'org_pg_policy_h',
        policyId: LIMIT,
        config: { mode: 'deny' },
        reason: 'x'.repeat(501),
        createdBy: 'usr_1',
      }),
    ).rejects.toThrow();
    expect(await settings.history('org_pg_policy_h', LIMIT)).toEqual([]);
  });

  it('a legacy row (pre-0023: no hash, defaults) reads as enabled with a derived hash', async () => {
    await pool.query(
      `INSERT INTO policy_settings (id, organization_id, policy_id, version, config, created_by, created_at)
       VALUES ('pol_legacy', 'org_pg_policy_i', $1, 1, '{"mode":"deny"}'::jsonb, 'usr_x', now())`,
      [LIMIT],
    );
    const record = await settings.current('org_pg_policy_i', LIMIT);
    expect(record).toMatchObject({ enabled: true, changeType: 'version', version: 1 });
    expect(record?.configHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the policy port applies only the caller organization configuration, read fresh from Postgres', async () => {
    // A brand-new repository instance proves the configuration is persisted, not cached.
    const fresh = new PgPolicySettingsRepository(db);
    const repositories = {
      budgets: {
        findById: async () => ({
          organizationId: ORG_A,
          workspaceId: 'wsp_1',
          id: 'bud_1',
          status: { value: 'active' },
          allocated: { minorUnits: 1_000_00, currency: 'INR' },
        }),
      },
      expenses: { listApprovedByBudget: async () => [] },
    } as never;
    const port = new ApiPolicyPort({ settings: fresh, repositories });
    const request = {
      workspaceId: 'wsp_1',
      userId: 'usr_1',
      capabilityId: 'finance.submit_expense',
      toolId: 'finance.submit_expense',
      action: 'tool.execute',
      sideEffectClass: 'consequential' as const,
      autonomyTier: 'supervised' as const,
      origin: 'chat',
      // 5,000.00 INR against a 1,000.00 INR allocation → overrun.
      input: { budgetId: 'bud_1', amountMinorUnits: 500_000, currency: 'INR', description: 'x' },
    };

    // ORG_A's CURRENT configuration (v2: require_approval) applies → approval, not denial.
    const a = await port.evaluate({ ...request, organizationId: ORG_A });
    expect(a.outcome).toBe('REQUIRE_APPROVAL');
    expect(a.matchedRules.some((r) => r.policyId === LIMIT && r.version === '1+config.2')).toBe(
      true,
    );

    // An organization with NO configuration is unaffected by ORG_A's (control).
    const none = await port.evaluate({ ...request, organizationId: 'org_pg_policy_c' });
    expect(none.matchedRules.some((r) => r.policyId === LIMIT)).toBe(false);

    // After ORG_A appends a DENY configuration (v3) the very next decision is a denial.
    await settings.append({
      organizationId: ORG_A,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'usr_admin',
    });
    const denied = await port.evaluate({ ...request, organizationId: ORG_A });
    expect(denied.outcome).toBe('DENY');
    expect(denied.matchedRules.find((r) => r.policyId === LIMIT)?.version).toBe('1+config.3');
  });

  it('an approval keeps the policy decision it was opened under (round-trip, never recomputed)', async () => {
    const engine = new PgApprovalEngine(db);
    const policy = {
      outcome: 'REQUIRE_APPROVAL' as const,
      policyId: 'POLICY_FINANCE_EXPENSE_APPROVAL',
      version: '1',
      reasonCode: 'MONEY_MOVEMENT',
      reason: 'Submitting an expense moves money and always requires human approval (BR-19)',
      fingerprint: 'REQUIRE_APPROVAL|POLICY_FINANCE_EXPENSE_APPROVAL@1=REQUIRE_APPROVAL',
      rules: [
        'POLICY_FINANCE_EXPENSE_APPROVAL@1=REQUIRE_APPROVAL',
        'POLICY_SIDE_EFFECT_APPROVAL@1=REQUIRE_APPROVAL',
      ],
    };
    const opened = await engine.open({
      conversationId: 'conv_policy',
      userId: 'usr_alice',
      tenantId: ORG_A,
      workspaceId: 'wsp_1',
      runId: 'run_1',
      stepId: 'finance.submit_expense',
      toolId: 'finance.submit_expense',
      capabilityId: 'finance.submit_expense',
      sideEffectClass: 'consequential',
      reason: policy.reason,
      intent: 'Submit an expense',
      input: { budgetId: 'bud_1', amountMinorUnits: 100, currency: 'INR', description: 'x' },
      policy,
    });
    expect((await engine.byId(opened.id))?.policy).toEqual(policy);

    // A later configuration change does not touch the stored decision.
    await settings.append({
      organizationId: ORG_A,
      policyId: LIMIT,
      config: { mode: 'require_approval' },
      createdBy: 'usr_admin',
    });
    expect((await new PgApprovalEngine(db).byId(opened.id))?.policy).toEqual(policy);

    // Control: an approval opened without a policy has none.
    const bare = await engine.open({
      conversationId: 'conv_policy',
      userId: 'usr_alice',
      tenantId: ORG_A,
      workspaceId: 'wsp_1',
      runId: 'run_2',
      stepId: 'calendar.create_event',
      toolId: 'calendar.create_event',
      capabilityId: 'calendar.create_event',
      sideEffectClass: 'consequential',
      reason: 'Approval required',
      intent: 'Create an event',
      input: { title: 't' },
    });
    expect((await engine.byId(bare.id))?.policy).toBeUndefined();
  });
});
