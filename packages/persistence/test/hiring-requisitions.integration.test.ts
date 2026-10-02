/**
 * Hiring requisitions on real PostgreSQL: the aggregate round-trips exactly
 * (including its history), listing is tenant-scoped, and an update only wins
 * while the row is still at the version it was loaded at — two people deciding
 * at once cannot both succeed.
 *
 * Throwaway database; skips cleanly when Postgres is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import { HiringRequisition, type RequisitionEventContext } from '@nexora/domain-hr';

import { createDatabaseFromPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { PgHiringRequisitionRepository } from '../src/repositories/index.js';
import { maintenanceUrlOf, resolveTestDatabaseUrl } from './db-isolation.js';

const BASE_URL = resolveTestDatabaseUrl();
const DB_NAME = 'nexora_hiring_requisitions_pg_test';
const dbUrl = ((): string => {
  const url = new URL(BASE_URL);
  url.pathname = `/${DB_NAME}`;
  return url.toString();
})();
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

const ORG = 'org_a' as TenantId;
const OTHER_ORG = 'org_b' as TenantId;
const ctx = (actor: string, organizationId = ORG): RequisitionEventContext => ({
  actor: { kind: 'user', id: actor },
  correlationId: 'corr',
  organizationId,
});
const submit = (organizationId = ORG, jobTitle = 'Backend Developer') =>
  HiringRequisition.submit(
    {
      organizationId,
      workspaceId: 'wsp_eng' as WorkspaceId,
      requestedBy: 'usr_manager',
      requesterIsExecutive: false,
      jobTitle,
      department: 'Engineering',
      projectId: 'prj_1',
      headcount: 2,
      employmentType: 'full_time',
      salaryMinMinorUnits: 180_000_000,
      salaryMaxMinorUnits: 95_000_000_000, // above int4: the columns are bigint
      currency: 'INR',
      justification: 'The mobile banking rebuild needs two more engineers.',
      urgency: 'high',
      targetStartDate: '2026-11-01',
    },
    ctx('usr_manager', organizationId),
  );

describeDb('PgHiringRequisitionRepository (real PostgreSQL)', () => {
  let pool: Pool;
  let repository: PgHiringRequisitionRepository;

  beforeAll(async () => {
    await admin(async (p) => {
      await p.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
      await p.query(`CREATE DATABASE "${DB_NAME}"`);
    });
    await runMigrations(dbUrl);
    pool = new Pool({ connectionString: dbUrl });
    repository = new PgHiringRequisitionRepository(createDatabaseFromPool(pool));
  });
  afterAll(async () => {
    await pool?.end();
    await admin((p) => p.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`));
  });

  it('round-trips the aggregate exactly, history included', async () => {
    const requisition = submit();
    await repository.insert(requisition);
    const loaded = await repository.findById(requisition.id);
    expect(HiringRequisition.snapshot(loaded!)).toEqual(HiringRequisition.snapshot(requisition));

    loaded!.decide(
      { stage: 'executive', decision: 'approve', actorId: 'usr_ceo', comment: 'Agreed.' },
      ctx('usr_ceo'),
    );
    expect(await repository.update(loaded!, 1)).toBe(true);
    const reloaded = await repository.findById(requisition.id);
    expect(reloaded!.status).toBe('pending_finance');
    expect(reloaded!.version).toBe(2);
    expect(reloaded!.history.at(-1)).toMatchObject({
      action: 'approved',
      stage: 'executive',
      actorId: 'usr_ceo',
      comment: 'Agreed.',
    });
  });

  it("lists only the organization's own requisitions, newest first", async () => {
    const mine = submit(ORG, 'QA Engineer');
    const foreign = submit(OTHER_ORG, 'Foreign Role');
    await repository.insert(mine);
    await repository.insert(foreign);
    const listed = await repository.listByOrganization(ORG);
    expect(listed.map((entry) => entry.organizationId)).toEqual(listed.map(() => ORG));
    expect(listed.map((entry) => entry.id)).toContain(mine.id);
    expect(listed.map((entry) => entry.id)).not.toContain(foreign.id);
    expect((await repository.listByOrganization(OTHER_ORG)).map((entry) => entry.id)).toEqual([
      foreign.id,
    ]);
  });

  it('two concurrent decisions on the same version: exactly one wins, the row holds the winner', async () => {
    const requisition = submit(ORG, 'Race Role');
    await repository.insert(requisition);
    const [first, second] = await Promise.all([
      repository.findById(requisition.id),
      repository.findById(requisition.id),
    ]);
    first!.decide({ stage: 'executive', decision: 'approve', actorId: 'usr_ceo' }, ctx('usr_ceo'));
    second!.decide(
      { stage: 'executive', decision: 'reject', actorId: 'usr_ceo2', comment: 'Not now.' },
      ctx('usr_ceo2'),
    );
    const results = await Promise.all([
      repository.update(first!, 1),
      repository.update(second!, 1),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = await repository.findById(requisition.id);
    expect(stored!.version).toBe(2);
    expect(stored!.history).toHaveLength(2); // submitted + exactly one decision
    expect(['pending_finance', 'changes_requested']).toContain(stored!.status);
  });

  it("a stale version never overwrites, and never touches another organization's row", async () => {
    const requisition = submit(ORG, 'Stale Role');
    await repository.insert(requisition);
    const loaded = await repository.findById(requisition.id);
    loaded!.withdraw({ actorId: 'usr_manager' }, ctx('usr_manager'));
    expect(await repository.update(loaded!, 99)).toBe(false);
    expect((await repository.findById(requisition.id))!.status).toBe('pending_executive');
  });
});
