/**
 * An accepted offer is ONE fact written to three places: the candidate
 * (hired), the opening (a seat turned into a hire) and the new employee
 * record. Against PostgreSQL (throwaway database; skips cleanly when Postgres
 * is unreachable) this proves the three are written together or not at all:
 * when creating the employee fails half-way, the candidate is still at the
 * offer stage, the seat is still held, no employee row exists, nothing was
 * announced — and the acceptance can simply be recorded again.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { RecruitingApplicationService } from '@nexora/application-hr';
import { EmployeeDomainService, type EmployeeRepository } from '@nexora/domain-hr';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';

import { buildApp, buildPgRepositories } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { demoIds, type DemoWorkspaceKey } from '../src/demo/world.js';
import { FakeOidcGateway } from './fakes.js';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';
const DB_NAME = 'nexora_recruiting_atomic_test';

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

interface CandidateRow {
  id: string;
  stage: string;
  employeeId?: string;
}
interface OpeningRow {
  id: string;
  status: string;
  offersOut: number;
  hiredCount: number;
}

describeDb('accepting an offer is all-or-nothing (PostgreSQL)', () => {
  let pool: Pool;
  let db: NexoraDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const ids = demoIds();
  const cookies = new Map<string, string>();

  async function as(persona: string): Promise<string> {
    const cached = cookies.get(persona);
    if (cached !== undefined) return cached;
    const response = await app.inject({
      method: 'POST',
      url: '/api/demo/login',
      headers: { 'content-type': 'application/json' },
      payload: { persona },
    });
    const raw = response.headers['set-cookie'];
    const cookie = ((Array.isArray(raw) ? raw[0] : raw) ?? '').split(';')[0] ?? '';
    cookies.set(persona, cookie);
    return cookie;
  }
  const scope = (workspace: DemoWorkspaceKey) => ({
    organizationId: ids.organizationId,
    workspaceId: ids.workspaceIds[workspace],
  });
  const post = async (
    persona: string,
    workspace: DemoWorkspaceKey,
    url: string,
    payload: Record<string, unknown> = {},
  ) => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: await as(persona), 'content-type': 'application/json' },
      payload: { ...scope(workspace), ...payload },
    });
    expect(response.statusCode, `${url}: ${response.body}`).toBeLessThan(300);
    return response.json() as Record<string, never>;
  };

  /** Runs the real chain up to an offer waiting for an answer. */
  async function offerOut(name: string): Promise<{ openingId: string; candidateId: string }> {
    const raised = (await post('manager', 'eng', '/api/hiring/requisitions', {
      jobTitle: `Backend Developer for ${name}`,
      department: 'Engineering Delivery',
      projectId: ids.projectId,
      headcount: 1,
      employmentType: 'full_time',
      salaryMinMinorUnits: 180_000_000,
      salaryMaxMinorUnits: 240_000_000,
      currency: 'INR',
      justification: 'The mobile banking rebuild needs another engineer.',
      urgency: 'normal',
    })) as unknown as { requisition: { id: string } };
    const decision = `/api/hiring/requisitions/${raised.requisition.id}/decision`;
    await post('ceo', 'eng', decision, { decision: 'approve' });
    await post('cfo', 'fin', decision, { decision: 'approve' });
    const opened = (await post('hr', 'hr', '/api/recruiting/openings', {
      requisitionId: raised.requisition.id,
      description: 'Build and run the banking backend services.',
    })) as unknown as { opening: { id: string } };
    const added = (await post(
      'hr',
      'hr',
      `/api/recruiting/openings/${opened.opening.id}/candidates`,
      { name, email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`, source: 'referral' },
    )) as unknown as { candidate: { id: string } };
    const base = `/api/recruiting/candidates/${added.candidate.id}`;
    await post('hr', 'hr', `${base}/advance`);
    await post('hr', 'hr', `${base}/advance`);
    await post('manager', 'eng', `${base}/feedback`, {
      rating: 4,
      recommendation: 'yes',
      notes: 'A strong hire for the team.',
    });
    await post('hr', 'hr', `${base}/offer`, {
      salaryMinorUnits: 200_000_000,
      startDate: '2026-11-01',
    });
    return { openingId: opened.opening.id, candidateId: added.candidate.id };
  }

  async function read(
    openingId: string,
  ): Promise<{ opening: OpeningRow; candidate: CandidateRow }> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/recruiting/openings/${openingId}?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds.hr}`,
      headers: { cookie: await as('hr') },
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { opening: OpeningRow; candidates: CandidateRow[] };
    return { opening: body.opening, candidate: body.candidates[0]! };
  }
  async function employeeNames(): Promise<string[]> {
    const result = await pool.query<{ name: string }>(
      'SELECT name FROM employees WHERE organization_id = $1',
      [ids.organizationId],
    );
    return result.rows.map((row) => row.name);
  }

  /**
   * The recruiting service over the REAL repositories, with an employee store
   * that fails on its second write — after the employee row was inserted,
   * while it is being marked as hired.
   */
  function serviceWithFailingEmployeeStore(atomic: boolean): {
    service: RecruitingApplicationService;
    published: unknown[];
  } {
    const repositories = buildPgRepositories(db, { s3: undefined } as never);
    let saves = 0;
    const employees: EmployeeRepository = {
      findById: (id) => repositories.employees.findById(id),
      findByName: (organizationId, name) => repositories.employees.findByName(organizationId, name),
      listByOrganization: (organizationId) =>
        repositories.employees.listByOrganization(organizationId),
      save: async (employee) => {
        saves += 1;
        if (saves === 2) throw new Error('the employee store went away');
        await repositories.employees.save(employee);
      },
    };
    const published: unknown[] = [];
    const service = new RecruitingApplicationService({
      openings: repositories.jobOpenings,
      candidates: repositories.candidates,
      requisitions: repositories.hiringRequisitions,
      employeesService: new EmployeeDomainService({ employees }),
      publisher: {
        publish: async (events: readonly unknown[]) => {
          published.push(...events);
        },
      } as never,
      ...(atomic && repositories.atomically !== undefined
        ? { atomically: repositories.atomically }
        : {}),
    });
    return { service, published };
  }
  const accept = (service: RecruitingApplicationService, candidateId: string) =>
    service.acceptOffer({
      organizationId: ids.organizationId as never,
      candidateId,
      actorId: ids.userIds.hr,
      correlationId: 'test-accept',
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

  it('a failure half-way leaves nothing behind, and the acceptance can be recorded again', async () => {
    const { openingId, candidateId } = await offerOut('Sarah Thomas');
    const before = await read(openingId);
    expect(before.candidate.stage).toBe('offer');
    expect(before.opening).toMatchObject({ status: 'open', offersOut: 1, hiredCount: 0 });
    const namesBefore = await employeeNames();

    const { service, published } = serviceWithFailingEmployeeStore(true);
    const failed = await accept(service, candidateId);
    expect(failed.ok).toBe(false);

    // Nothing of the half-done acceptance remains.
    const after = await read(openingId);
    expect(after.candidate.stage).toBe('offer');
    expect(after.candidate.employeeId).toBeUndefined();
    expect(after.opening).toMatchObject({ status: 'open', offersOut: 1, hiredCount: 0 });
    expect(await employeeNames()).toEqual(namesBefore);
    expect(published).toEqual([]);

    // So HR is not stuck: recording the answer again works, completely.
    const accepted = await post(
      'hr',
      'hr',
      `/api/recruiting/candidates/${candidateId}/offer/response`,
      {
        response: 'accept',
      },
    );
    const done = await read(openingId);
    expect(done.candidate.stage).toBe('hired');
    expect(done.candidate.employeeId).toBe(
      (accepted as unknown as { employeeId: string }).employeeId,
    );
    expect(done.opening).toMatchObject({ status: 'filled', offersOut: 0, hiredCount: 1 });
    expect((await employeeNames()).filter((name) => name === 'Sarah Thomas')).toHaveLength(1);
  });

  it('without the atomic runner the same failure leaves a half-hired candidate (what the runner prevents)', async () => {
    const { openingId, candidateId } = await offerOut('Dev Raman');
    const { service } = serviceWithFailingEmployeeStore(false);
    expect((await accept(service, candidateId)).ok).toBe(false);
    const after = await read(openingId);
    // The candidate and the seat moved on, with no usable employee behind them.
    expect(after.candidate.stage).toBe('hired');
    expect(after.candidate.employeeId).toBeUndefined();
    expect(after.opening.hiredCount).toBe(1);
  });

  it('two answers at once still record exactly one hire', async () => {
    const { openingId, candidateId } = await offerOut('Leela Nair');
    const answer = async () =>
      app.inject({
        method: 'POST',
        url: `/api/recruiting/candidates/${candidateId}/offer/response`,
        headers: { cookie: await as('hr'), 'content-type': 'application/json' },
        payload: { ...scope('hr'), response: 'accept' },
      });
    const results = await Promise.all([answer(), answer(), answer()]);
    expect(results.filter((response) => response.statusCode === 200)).toHaveLength(1);
    const after = await read(openingId);
    expect(after.candidate.stage).toBe('hired');
    expect(after.opening).toMatchObject({ status: 'filled', offersOut: 0, hiredCount: 1 });
    expect((await employeeNames()).filter((name) => name === 'Leela Nair')).toHaveLength(1);
  });
});
