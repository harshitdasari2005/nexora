/**
 * Recruiting on real PostgreSQL: openings and candidates round-trip exactly,
 * a hiring request gets at most one opening, updates are optimistic (the last
 * approved seat cannot be reserved twice), and an employee keeps the details
 * captured at hire.
 *
 * Throwaway database; skips cleanly when Postgres is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import { Candidate, Employee, JobOpening, type RecruitingEventContext } from '@nexora/domain-hr';

import { createDatabaseFromPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import {
  PgCandidateRepository,
  PgEmployeeRepository,
  PgJobOpeningRepository,
} from '../src/repositories/index.js';
import { maintenanceUrlOf, resolveTestDatabaseUrl } from './db-isolation.js';

const BASE_URL = resolveTestDatabaseUrl();
const DB_NAME = 'nexora_recruiting_pg_test';
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
const WORKSPACE = 'wsp_eng' as WorkspaceId;
const ctx = (organizationId = ORG): RecruitingEventContext => ({
  actor: { kind: 'user', id: 'usr_hr' },
  correlationId: 'corr',
  organizationId,
});
const APPROVED = {
  salaryMinMinorUnits: 180_000_000,
  salaryMaxMinorUnits: 240_000_000,
  currency: 'INR',
};
const open = (requisitionId: string, headcount = 1, organizationId = ORG) =>
  JobOpening.open(
    {
      organizationId,
      requisitionId,
      workspaceId: WORKSPACE,
      hiringManagerId: 'usr_manager',
      openedBy: 'usr_hr',
      title: 'Backend Developer',
      department: 'Engineering',
      headcount,
      employmentType: 'full_time',
      ...APPROVED,
      description: 'Build and run the banking backend services.',
    },
    ctx(organizationId),
  );

describeDb('recruiting repositories (real PostgreSQL)', () => {
  let pool: Pool;
  let openings: PgJobOpeningRepository;
  let candidates: PgCandidateRepository;
  let employees: PgEmployeeRepository;

  beforeAll(async () => {
    await admin(async (p) => {
      await p.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
      await p.query(`CREATE DATABASE "${DB_NAME}"`);
    });
    await runMigrations(dbUrl);
    pool = new Pool({ connectionString: dbUrl });
    const db = createDatabaseFromPool(pool);
    openings = new PgJobOpeningRepository(db);
    candidates = new PgCandidateRepository(db);
    employees = new PgEmployeeRepository(db);
  });
  afterAll(async () => {
    await pool?.end();
    await admin((p) => p.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`));
  });

  it('an opening round-trips exactly and is found by its hiring request, tenant-scoped', async () => {
    const opening = open('req_round_trip', 2);
    expect(await openings.insert(opening)).toBe(true);
    expect(JobOpening.snapshot((await openings.findById(opening.id))!)).toEqual(
      JobOpening.snapshot(opening),
    );
    expect((await openings.findByRequisition(ORG, 'req_round_trip'))?.id).toBe(opening.id);
    expect(await openings.findByRequisition('org_b' as TenantId, 'req_round_trip')).toBeUndefined();
    expect((await openings.listByOrganization('org_b' as TenantId)).length).toBe(0);
  });

  it('a hiring request gets at most ONE opening (a second insert reports false)', async () => {
    expect(await openings.insert(open('req_single'))).toBe(true);
    expect(await openings.insert(open('req_single'))).toBe(false);
    // The same request id in another organization is a different request.
    expect(await openings.insert(open('req_single', 1, 'org_b' as TenantId))).toBe(true);
    const count = await pool.query(
      `SELECT count(*)::int AS n FROM job_openings WHERE organization_id = $1 AND requisition_id = $2`,
      [ORG, 'req_single'],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('the last approved seat cannot be reserved twice by concurrent offers', async () => {
    const opening = open('req_last_seat', 1);
    await openings.insert(opening);
    const [first, second] = await Promise.all([
      openings.findById(opening.id),
      openings.findById(opening.id),
    ]);
    first!.reserveOffer();
    second!.reserveOffer();
    const results = await Promise.all([openings.update(first!, 1), openings.update(second!, 1)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = JobOpening.snapshot((await openings.findById(opening.id))!);
    expect(stored.offersOut).toBe(1);
    expect(stored.version).toBe(2);
  });

  it('a candidate round-trips with feedback, offer and history; updates are optimistic', async () => {
    const candidate = Candidate.add(
      {
        organizationId: ORG,
        openingId: 'job_x',
        workspaceId: WORKSPACE,
        name: 'Sarah Thomas',
        email: 'sarah@example.com',
        phone: '+91 98765 43210',
        source: 'referral',
        resumeNotes: '8 years of backend experience.',
        addedBy: 'usr_hr',
      },
      ctx(),
    );
    await candidates.insert(candidate);
    const loaded = (await candidates.findById(candidate.id))!;
    expect(Candidate.snapshot(loaded)).toEqual(Candidate.snapshot(candidate));

    loaded.advance('usr_hr', ctx());
    loaded.advance('usr_hr', ctx());
    loaded.recordFeedback(
      { by: 'usr_manager', rating: 5, recommendation: 'strong_yes', notes: 'Excellent.' },
      ctx(),
    );
    loaded.extendOffer(
      { salaryMinorUnits: 200_000_000, startDate: '2026-11-01', by: 'usr_hr' },
      APPROVED,
      ctx(),
    );
    expect(await candidates.update(loaded, 1)).toBe(true);
    expect(await candidates.update(loaded, 1)).toBe(false); // stale version
    const reloaded = (await candidates.findById(candidate.id))!;
    expect(Candidate.snapshot(reloaded)).toEqual(Candidate.snapshot(loaded));
    expect(reloaded.offer).toMatchObject({ status: 'extended', salaryMinorUnits: 200_000_000 });
    expect((await candidates.listByOpening(ORG, 'job_x')).map((c) => c.id)).toEqual([candidate.id]);
    expect(await candidates.listByOpening('org_b' as TenantId, 'job_x')).toEqual([]);
  });

  it('an employee keeps the details captured at hire; a legacy name-only record still loads', async () => {
    const context = {
      actor: { kind: 'user' as const, id: 'usr_hr' },
      correlationId: 'c',
      organizationId: ORG,
    };
    const hired = Employee.create(
      {
        organizationId: ORG,
        name: 'Sarah Thomas',
        profile: {
          email: 'sarah@example.com',
          jobTitle: 'Backend Developer',
          department: 'Engineering',
          employmentType: 'full_time',
          startDate: '2026-11-01',
          requisitionId: 'req_1',
        },
      },
      context,
    );
    const legacy = Employee.create({ organizationId: ORG, name: 'Legacy Person' }, context);
    await employees.save(hired);
    await employees.save(legacy);
    expect(Employee.snapshot((await employees.findById(hired.id))!)).toEqual(
      Employee.snapshot(hired),
    );
    expect((await employees.findById(legacy.id))!.profile).toBeUndefined();
  });
});
