/**
 * Prompt 4 — agent identity + delegation persistence (PostgreSQL) round-trip.
 *
 * Verifies the Pg repositories behind the `@nexora/module-agents` ports
 * against a REAL database created from the repo migrations (so the 0019
 * migration itself — tables, indexes, the agent→delegation FK — is
 * exercised): create/read round-trip, tenant-scoped reads (a foreign
 * organization never resolves an agent or delegation), suspension and
 * revocation persist across reads without touching history, immutable grant
 * facts survive an upsert that tries to change them, and the FK forbids
 * deleting an agent that has delegations (history is never cascaded away).
 *
 * Runs on a throwaway database and skips cleanly when Postgres is
 * unreachable, so `pnpm test` stays green without infra.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';
import type { AgentDelegation, AgentPrincipal } from '@nexora/contracts/agent';
import {
  PgAgentDelegationRepository,
  PgAgentIdentityRepository,
} from '../src/agent/pg-agent-identity-repository.js';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';
const DB_NAME = 'nexora_agent_identity_test';

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

const ORG = 'org_pg_agents';
const OTHER_ORG = 'org_pg_other';
const WORKSPACE = 'wsp_pg_agents';
const AT = '2026-09-01T09:00:00.000Z';

const agent: AgentPrincipal = {
  id: 'agt_pg_1',
  organizationId: ORG,
  workspaceId: WORKSPACE,
  definitionId: 'executive',
  name: 'Chief of Staff',
  description: 'persistence round-trip',
  status: 'active',
  ownerUserId: 'usr_owner',
  createdBy: 'usr_owner',
  createdAt: AT,
  updatedAt: AT,
};

const delegation: AgentDelegation = {
  id: 'dlg_pg_1',
  agentId: agent.id,
  organizationId: ORG,
  workspaceId: WORKSPACE,
  grantedByUserId: 'usr_owner',
  capabilityId: 'projects.find_project',
  resourceScope: { kind: 'project', id: 'prj_pg_1' },
  status: 'active',
  createdAt: AT,
  expiresAt: '2026-12-01T00:00:00.000Z',
  metadata: { note: 'round-trip' },
};

describeDb('agent identity + delegation persistence (PostgreSQL)', () => {
  let pool: Pool;
  let db: NexoraDatabase;
  let agents: PgAgentIdentityRepository;
  let delegations: PgAgentDelegationRepository;

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
    agents = new PgAgentIdentityRepository(db);
    delegations = new PgAgentDelegationRepository(db);
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

  it('round-trips an agent and a scoped, expiring delegation', async () => {
    await agents.save(agent);
    await delegations.save(delegation);

    expect(await agents.findById(ORG, agent.id)).toEqual(agent);
    expect(await delegations.findById(ORG, delegation.id)).toEqual(delegation);
    expect(await delegations.listByAgent(ORG, agent.id)).toEqual([delegation]);
    expect(await agents.listByWorkspace(ORG, WORKSPACE)).toEqual([agent]);
  });

  it('never resolves an agent or delegation for another organization (or workspace)', async () => {
    expect(await agents.findById(OTHER_ORG, agent.id)).toBeUndefined();
    expect(await delegations.findById(OTHER_ORG, delegation.id)).toBeUndefined();
    expect(await delegations.listByAgent(OTHER_ORG, agent.id)).toEqual([]);
    expect(await agents.listByWorkspace(OTHER_ORG, WORKSPACE)).toEqual([]);
    expect(await agents.listByWorkspace(ORG, 'wsp_elsewhere')).toEqual([]);
  });

  it('persists suspension and reactivation, keeping the identity facts immutable', async () => {
    await agents.save({
      ...agent,
      status: 'suspended',
      statusChangedBy: 'usr_admin',
      statusReason: 'investigation',
      updatedAt: '2026-09-02T09:00:00.000Z',
      // An upsert must NOT be able to move the agent or change its definition.
      organizationId: OTHER_ORG,
      workspaceId: 'wsp_moved',
      definitionId: 'finance',
    });
    const suspended = await agents.findById(ORG, agent.id);
    expect(suspended).toMatchObject({
      status: 'suspended',
      statusChangedBy: 'usr_admin',
      statusReason: 'investigation',
      organizationId: ORG,
      workspaceId: WORKSPACE,
      definitionId: 'executive',
    });
    expect(await agents.findById(OTHER_ORG, agent.id)).toBeUndefined();

    await agents.save({ ...agent, status: 'active', updatedAt: '2026-09-03T09:00:00.000Z' });
    expect((await agents.findById(ORG, agent.id))?.status).toBe('active');

    await agents.save({ ...agent, status: 'revoked', updatedAt: '2026-09-04T09:00:00.000Z' });
    expect((await agents.findById(ORG, agent.id))?.status).toBe('revoked');
  });

  it('persists revocation as a state change: the record and its grant facts survive', async () => {
    await delegations.save({
      ...delegation,
      status: 'revoked',
      revokedAt: '2026-09-02T10:00:00.000Z',
      revokedBy: 'usr_admin',
      revokeReason: 'no longer needed',
      // An upsert must not be able to widen the grant.
      capabilityId: 'projects.create_project',
      resourceScope: { kind: 'project', id: 'prj_other' },
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    const revoked = await delegations.findById(ORG, delegation.id);
    expect(revoked).toMatchObject({
      status: 'revoked',
      revokedAt: '2026-09-02T10:00:00.000Z',
      revokedBy: 'usr_admin',
      revokeReason: 'no longer needed',
      capabilityId: delegation.capabilityId,
      resourceScope: delegation.resourceScope,
      expiresAt: delegation.expiresAt,
      grantedByUserId: 'usr_owner',
    });
    expect(await delegations.listByAgent(ORG, agent.id)).toHaveLength(1);
  });

  it('the foreign key forbids deleting an agent that has delegations (history is never cascaded)', async () => {
    await expect(pool.query('DELETE FROM agents WHERE id = $1', [agent.id])).rejects.toThrow(
      /foreign key|violates/i,
    );
    expect(await agents.findById(ORG, agent.id)).toBeDefined();
    expect(await delegations.listByAgent(ORG, agent.id)).toHaveLength(1);
  });

  it('has the tenant-scoped indexes the execution-time lookups rely on', async () => {
    const result = await pool.query(
      `SELECT tablename, indexname FROM pg_indexes WHERE tablename IN ('agents', 'agent_delegations')`,
    );
    const names = result.rows.map((row: { indexname: string }) => row.indexname);
    expect(names.some((name) => name.includes('agent_delegations'))).toBe(true);
    expect(names.length).toBeGreaterThanOrEqual(4);
  });
});
