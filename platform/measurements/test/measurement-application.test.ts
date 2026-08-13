/**
 * @nexora/module-measurements — application tests.
 *
 * Verifies the application service delegates to the repository port with the
 * trusted tenant scope, and that the fake repository's snapshot shape is the
 * contract the API layer consumes.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import {
  GetTenantMeasurementsHandler,
  MeasurementApplicationService,
  type MeasurementRepository,
  type TenantMeasurementsSnapshot,
} from '../src/index.js';

const TENANT: TenantId = 'org_measurements_test' as TenantId;

/** An in-memory {@link MeasurementRepository} with a seeded snapshot. */
class StubMeasurementRepository implements MeasurementRepository {
  readonly requestedTenants: TenantId[] = [];
  #snapshot: TenantMeasurementsSnapshot;

  constructor(snapshot: TenantMeasurementsSnapshot) {
    this.#snapshot = snapshot;
  }

  async loadTenantMeasurements(tenantId: TenantId): Promise<TenantMeasurementsSnapshot> {
    this.requestedTenants.push(tenantId);
    return { ...this.#snapshot, tenantId };
  }
}

function sampleSnapshot(): TenantMeasurementsSnapshot {
  return {
    tenantId: TENANT,
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
        userId: 'usr_1',
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
}

describe('MeasurementApplicationService', () => {
  it('delegates to the repository with the trusted tenant scope', async () => {
    const repo = new StubMeasurementRepository(sampleSnapshot());
    const service = new MeasurementApplicationService(repo);

    const snapshot = await service.getTenantMeasurements({ tenantId: TENANT });

    expect(repo.requestedTenants).toEqual([TENANT]);
    expect(snapshot.tenantId).toBe(TENANT);
  });

  it('returns the full dashboard metric groups in the contract shape', async () => {
    const repo = new StubMeasurementRepository(sampleSnapshot());
    const handler = new GetTenantMeasurementsHandler(new MeasurementApplicationService(repo));

    const snapshot = await handler.handle({ tenantId: TENANT });

    // Workflow health: success rate + unrecoverable error rate.
    expect(snapshot.workflowHealth).toHaveLength(1);
    expect(snapshot.workflowHealth[0]?.successRate).toBe(90);
    expect(snapshot.workflowHealth[0]?.unrecoverableErrorRate).toBe(10);
    expect(snapshot.workflowHealth[0]?.cycleTimeP95Ms).toBe(40_000);

    // Onboarding: time-to-first-workflow derived value.
    expect(snapshot.onboarding[0]?.timeToFirstWorkflowMs).toBe(900_000);
    expect(snapshot.onboarding[0]?.firstWorkflowAt).not.toBeNull();

    // Audit completeness: traceable share.
    expect(snapshot.auditCompleteness.traceableShare).toBe(100);
    expect(snapshot.auditCompleteness.totalEvents).toBe(10);
    expect(snapshot.auditCompleteness.untracedTypes).toEqual([]);

    // Overview counts.
    expect(snapshot.overview).toEqual({
      users: 2,
      workspaces: 1,
      projects: 3,
      documents: 5,
      knowledgeSources: 4,
      calendarEvents: 6,
    });
  });
});
