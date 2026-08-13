/**
 * S23 Insights (pilot measurement dashboard) API tests (`fastify.inject`):
 *
 * - `/api/insights` returns the tenant measurement snapshot (workflow health,
 *   onboarding, audit completeness, tenant overview) for the authenticated
 *   user's organization.
 * - The tenant is resolved from TRUSTED organization membership — a forged
 *   `organizationId` that the user does not belong to resolves to the
 *   user's own organization, never to the foreign one's numbers.
 * - A forged or foreign `workspaceId` resolves to 403.
 * - Unauthenticated access resolves to 401.
 * - The measurement snapshot is seeded via the fake repository and returned
 *   verbatim (the metric computation is the repository's job, tested at the
 *   persistence layer against real SQL).
 */

import { describe, expect, it } from 'vitest';

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { TenantMeasurementsSnapshot } from '@nexora/module-measurements';
import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  seedWorkspace,
  seedWorkspaceMembership,
  type ChatClient,
} from './helpers.js';
import type { FakeMeasurementRepository } from './fakes.js';

/** Seeds a snapshot for the user's own organization. */
function seedSnapshot(client: ChatClient, organizationId: string): TenantMeasurementsSnapshot {
  const snapshot: TenantMeasurementsSnapshot = {
    tenantId: organizationId as TenantId,
    generatedAt: '2026-08-13T00:00:00.000Z',
    workflowHealth: [
      {
        definitionKey: 'employee-onboarding',
        total: 10,
        succeeded: 9,
        failed: 1,
        successRate: 90,
        unrecoverableErrorRate: 10,
        cycleTimeP50Ms: 12_000,
        cycleTimeP95Ms: 40_000,
      },
    ],
    onboarding: [
      {
        userId: currentUserId(client),
        email: 'alex@nexora.dev',
        signedUpAt: '2026-08-01T00:00:00.000Z',
        firstWorkflowAt: '2026-08-01T00:15:00.000Z',
        timeToFirstWorkflowMs: 900_000,
      },
    ],
    auditCompleteness: {
      traceableShare: 100,
      totalEvents: 10,
      tracedEvents: 10,
      untracedTypes: [],
    },
    overview: {
      users: 2,
      workspaces: 1,
      projects: 3,
      documents: 5,
      knowledgeSources: 4,
      calendarEvents: 6,
    },
  };
  (client.repos.measurements as FakeMeasurementRepository).seed(
    organizationId as TenantId,
    snapshot,
  );
  return snapshot;
}

describe('GET /api/insights', () => {
  it('returns the tenant measurement snapshot for the authenticated organization', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const seeded = seedSnapshot(client, organizationId);

    const response = await client.get(`/api/insights?workspaceId=${workspaceId}`);

    expect(response.statusCode).toBe(200);
    const body = response.json() as { measurements: TenantMeasurementsSnapshot };
    expect(body.measurements.tenantId).toBe(organizationId);
    expect(body.measurements.workflowHealth).toEqual(seeded.workflowHealth);
    expect(body.measurements.onboarding).toEqual(seeded.onboarding);
    expect(body.measurements.auditCompleteness).toEqual(seeded.auditCompleteness);
    expect(body.measurements.overview).toEqual(seeded.overview);
  });

  it('rejects a forged foreign workspace with 403 (never another workspace numbers)', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    seedSnapshot(client, organizationId);

    await seedWorkspace(client.repos, {
      id: 'wsp_foreign_insights',
      organizationId,
      slug: 'foreign',
    });

    const response = await client.get('/api/insights?workspaceId=wsp_foreign_insights');

    expect(response.statusCode).toBe(403);
  });

  it('ignores a forged foreign organizationId (resolves to the trusted membership)', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const seeded = seedSnapshot(client, organizationId);

    // A foreign org id that the user is NOT a member of: the route must fall
    // back to the trusted membership and return the user's own organization.
    const response = await client.get('/api/insights?organizationId=org_evil');

    expect(response.statusCode).toBe(200);
    const body = response.json() as { measurements: TenantMeasurementsSnapshot };
    expect(body.measurements.tenantId).toBe(organizationId);
    expect(body.measurements.overview).toEqual(seeded.overview);
  });

  it('resolves a second membership when the user belongs to two organizations', async () => {
    const client = await chatClient();
    const userId = currentUserId(client);
    const { organizationId: firstOrg } = await onboardOrgAndWorkspace(client);

    // A second organization with its own workspace + snapshot.
    const second = await client.post('/api/organizations', {
      name: 'Second Co.',
      slug: 'second-co',
      type: 'startup',
    });
    expect(second.statusCode).toBe(201);
    const secondOrg = (second.json().organization as { id: string }).id as TenantId;
    await seedWorkspace(client.repos, {
      id: 'wsp_second_insights',
      organizationId: secondOrg,
      slug: 'second',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: 'wsp_second_insights' as WorkspaceId,
      userId,
      role: 'member',
      organizationId: secondOrg,
    });
    const secondSnapshot: TenantMeasurementsSnapshot = {
      tenantId: secondOrg,
      generatedAt: '2026-08-13T00:00:00.000Z',
      workflowHealth: [],
      onboarding: [],
      auditCompleteness: {
        traceableShare: 100,
        totalEvents: 0,
        tracedEvents: 0,
        untracedTypes: [],
      },
      overview: {
        users: 1,
        workspaces: 1,
        projects: 0,
        documents: 0,
        knowledgeSources: 0,
        calendarEvents: 0,
      },
    };
    (client.repos.measurements as FakeMeasurementRepository).seed(secondOrg, secondSnapshot);

    const response = await client.get(`/api/insights?organizationId=${secondOrg}`);

    expect(response.statusCode).toBe(200);
    const body = response.json() as { measurements: TenantMeasurementsSnapshot };
    expect(body.measurements.tenantId).toBe(secondOrg);
    expect(body.measurements.overview.users).toBe(1);
    void firstOrg;
    void userId;
  });

  it('rejects unauthenticated access with 401', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    seedSnapshot(client, organizationId);

    const response = await client.app.inject({ method: 'GET', url: '/api/insights' });

    expect(response.statusCode).toBe(401);
  });
});
