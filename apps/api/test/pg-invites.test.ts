/**
 * Taking an invited seat is ONE fact written to three places: the invitation
 * (used), the organization membership and the team seat. Against PostgreSQL
 * (throwaway database; skips cleanly when Postgres is unreachable) this
 * proves they are written together or not at all: when the team seat cannot
 * be saved, the person is not in the organization, the link is still unused,
 * and it works the moment the fault is gone. It also proves a link gives its
 * seat to exactly one of two people who open it at the same moment.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';

import { buildApp, buildPgRepositories } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MultiIdentityGateway } from './fakes.js';
import { login } from './helpers.js';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';
const DB_NAME = 'nexora_invites_test';

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

const issuer = 'http://keycloak.test/realms/nexora';
const person = (subject: string, displayName: string) => ({
  subject,
  email: `${subject}@acme.test`,
  emailVerified: true,
  displayName,
  issuer,
});

describeDb('taking an invited seat is all-or-nothing (PostgreSQL)', () => {
  let pool: Pool;
  let db: NexoraDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let founder: string;
  let first: string;
  let second: string;
  let third: string;
  let organizationId: string;
  let teamId: string;
  // While set, saving a team seat fails after the invitation was marked used.
  let seatStoreDown = false;

  const post = (cookie: string, url: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie, 'content-type': 'application/json' },
      payload,
    });
  const newLink = async (label: string): Promise<string> => {
    const response = await post(founder, '/api/invites', {
      organizationId,
      teamId,
      seat: 'member',
      label,
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { invite: { code: string } }).invite.code;
  };
  const count = async (sql: string, values: unknown[]): Promise<number> =>
    Number((await pool.query<{ n: string }>(sql, values)).rows[0]?.n ?? 0);
  const seats = () =>
    count('SELECT count(*) AS n FROM workspace_memberships WHERE workspace_id = $1', [teamId]);
  const orgMembers = () =>
    count('SELECT count(*) AS n FROM organization_memberships WHERE organization_id = $1', [
      organizationId,
    ]);
  const usedLinks = () =>
    count(
      'SELECT count(*) AS n FROM workspace_invites WHERE organization_id = $1 AND used_at IS NOT NULL',
      [organizationId],
    );

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
    const config = loadConfig({
      DATABASE_URL: DB_URL,
      LOG_LEVEL: 'error',
      INTEGRATIONS_INBOUND_SECRET: 'test-inbound-secret',
    } as NodeJS.ProcessEnv);
    const repositories = buildPgRepositories(db, config);
    const real = repositories.workspaceMemberships;
    app = await buildApp({
      config,
      oidc: new MultiIdentityGateway([
        person('founder', 'Farah Founder'),
        person('first', 'First Person'),
        person('second', 'Second Person'),
        person('third', 'Third Person'),
      ]),
      database: db,
      repositories: {
        ...repositories,
        workspaceMemberships: {
          findById: (id) => real.findById(id),
          findByWorkspaceAndUser: (workspace, user) => real.findByWorkspaceAndUser(workspace, user),
          listByWorkspace: (workspace) => real.listByWorkspace(workspace),
          listByUser: (user) => real.listByUser(user),
          countOwners: (workspace) => real.countOwners(workspace),
          remove: (membership) => real.remove(membership),
          save: async (membership) => {
            if (seatStoreDown) throw new Error('the seat store went away');
            await real.save(membership);
          },
        },
      },
    });
    await app.ready();
    founder = await login(app);
    first = await login(app);
    second = await login(app);
    third = await login(app);
    const organization = await post(founder, '/api/organizations', {
      name: 'Acme',
      slug: 'acme',
      type: 'startup',
    });
    organizationId = (organization.json() as { organization: { id: string } }).organization.id;
    const team = await post(founder, '/api/workspaces', {
      organizationId,
      name: 'Engineering',
      slug: 'engineering',
      type: 'engineering',
    });
    teamId = (team.json() as { workspace: { id: string } }).workspace.id;
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

  it('a failure half-way leaves nothing behind, and the same link still works afterwards', async () => {
    const code = await newLink('First person');
    expect(await seats()).toBe(1);
    expect(await orgMembers()).toBe(1);

    seatStoreDown = true;
    const failed = await post(first, '/api/invites/accept', { code });
    seatStoreDown = false;
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);

    // Not in the organization, no seat, and the link was not spent.
    expect(await orgMembers()).toBe(1);
    expect(await seats()).toBe(1);
    expect(await usedLinks()).toBe(0);

    const joined = await post(first, '/api/invites/accept', { code });
    expect(joined.statusCode, joined.body).toBe(200);
    expect(await orgMembers()).toBe(2);
    expect(await seats()).toBe(2);
    expect(await usedLinks()).toBe(1);
  });

  it('gives a link opened by two people at once to exactly one of them', async () => {
    const code = await newLink('Whoever is first');
    const answers = await Promise.all([
      post(second, '/api/invites/accept', { code }),
      post(third, '/api/invites/accept', { code }),
    ]);
    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 404]);
    expect(await seats()).toBe(3);
    expect(await orgMembers()).toBe(3);
    expect(await usedLinks()).toBe(2);
  });
});
