/**
 * Audit Center — query-service bounding of the workflow step journal (P2-2).
 *
 * The final V1 QA audit flagged that `AuditQueryService` fetched the ENTIRE
 * `workflow_step_executions` journal for the tenant on every page load
 * (`PgWorkflowStepExecutionRepository.listByTenant` had no `ORDER BY` and no
 * `LIMIT`), unlike every sibling journal in the same method. These tests pin
 * the fix: the service must pass a finite bound, the newest rows must win,
 * and tenant isolation is unaffected.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';
import { WorkflowStepExecution } from '@nexora/module-workflow';

import { AuditQueryService } from '../src/audit/audit-query-service.js';
import { FakeWorkflowStepExecutionRepository } from './fakes.js';

const TENANT = 'org_audit_bound' as TenantId;
const OTHER_TENANT = 'org_other' as TenantId;

/** A pending step-journal record for `tenantId`, stamped at `createdAt`. */
function stepRecord(tenantId: TenantId, index: number, createdAt: string): WorkflowStepExecution {
  return WorkflowStepExecution.create(
    {
      workflowId: `wkf_${tenantId}_${index}`,
      tenantId,
      stepId: `step_${index}`,
      name: `Step ${index}`,
      capabilityId: 'workflow.run',
      toolId: 'workflow.run',
      input: {},
    },
    createdAt,
  );
}

/** An ISO timestamp `minutesFromEpochBase` minutes after a fixed base. */
function isoAt(minutes: number): string {
  return new Date(Date.UTC(2026, 0, 1) + minutes * 60_000).toISOString();
}

/**
 * Builds an {@link AuditQueryService} whose only live journal is the step
 * repository; every other source returns nothing. `stepSpy` captures the
 * `limit` the service passes through to `listByTenant`.
 */
function serviceWithSteps(repo: FakeWorkflowStepExecutionRepository): {
  service: AuditQueryService;
  calls: Array<number | undefined>;
} {
  const calls: Array<number | undefined> = [];
  const stepSpy = {
    async listByTenant(tenantId: TenantId, limit?: number) {
      calls.push(limit);
      return repo.listByTenant(tenantId, limit);
    },
  };
  const service = new AuditQueryService({
    agentExecutions: undefined,
    approvals: { listByTenant: () => [] },
    workflowStepExecutions: stepSpy,
    workflowInstances: { listByTenant: async () => [] },
    activity: { listByWorkspace: async () => [] },
    users: { findById: async () => undefined },
    workspaces: { findById: async () => undefined },
    catalog: {},
    // The stubs above satisfy only the members this scenario exercises.
  } as unknown as ConstructorParameters<typeof AuditQueryService>[0]);
  return { service, calls };
}

describe('AuditQueryService — workflow step journal is bounded (P2-2)', () => {
  it('passes a finite limit to workflowStepExecutions.listByTenant', async () => {
    const repo = new FakeWorkflowStepExecutionRepository();
    for (let i = 0; i < 50; i += 1) {
      await repo.save(stepRecord(TENANT, i, isoAt(i)));
    }
    const { service, calls } = serviceWithSteps(repo);

    await service.listEvents({ tenantId: TENANT }, {}, 200);

    expect(calls).toHaveLength(1);
    expect(typeof calls[0]).toBe('number');
    expect(Number.isFinite(calls[0])).toBe(true);
    // Math.max(limit * 2, 200) — the same generous per-source fetch budget
    // every other journal in listEvents already used.
    expect(calls[0]).toBe(400);
  });

  it('returns only the newest rows when the journal is larger than the bound', async () => {
    const repo = new FakeWorkflowStepExecutionRepository();
    // 900 rows: chronological, oldest first. The bound is 400, so the
    // oldest 500 must never reach the merged feed.
    for (let i = 0; i < 900; i += 1) {
      await repo.save(stepRecord(TENANT, i, isoAt(i)));
    }
    const { service } = serviceWithSteps(repo);

    const events = await service.listEvents({ tenantId: TENANT }, {}, 200);

    // Page size is honoured.
    expect(events).toHaveLength(200);
    // Newest-first ordering.
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i - 1]!.occurredAt >= events[i]!.occurredAt).toBe(true);
    }
    // The newest seeded row is present; the oldest is not (proving the
    // fetch was bounded + ordered, not a full-journal scan then slice).
    expect(events[0]!.occurredAt).toBe(isoAt(899));
    const occurredAts = events.map((e) => e.occurredAt);
    expect(occurredAts).not.toContain(isoAt(0));
    expect(occurredAts).not.toContain(isoAt(400));
  });

  it('never returns another tenant’s step rows', async () => {
    const repo = new FakeWorkflowStepExecutionRepository();
    for (let i = 0; i < 10; i += 1) {
      await repo.save(stepRecord(TENANT, i, isoAt(i)));
      await repo.save(stepRecord(OTHER_TENANT, i, isoAt(i)));
    }
    const { service } = serviceWithSteps(repo);

    const events = await service.listEvents({ tenantId: TENANT }, {}, 200);

    expect(events).toHaveLength(10);
    for (const event of events) {
      expect(event.references?.workflowId).toMatch(/org_audit_bound/);
    }
  });
});

describe('FakeWorkflowStepExecutionRepository.listByTenant — mirrors the Pg contract', () => {
  it('orders newest-first and applies the limit (default 500)', async () => {
    const repo = new FakeWorkflowStepExecutionRepository();
    for (let i = 0; i < 12; i += 1) {
      await repo.save(stepRecord(TENANT, i, isoAt(i)));
    }

    const bounded = await repo.listByTenant(TENANT, 5);
    expect(bounded).toHaveLength(5);
    expect(bounded.map((r) => r.createdAt)).toEqual([
      isoAt(11),
      isoAt(10),
      isoAt(9),
      isoAt(8),
      isoAt(7),
    ]);

    const all = await repo.listByTenant(TENANT);
    expect(all).toHaveLength(12);
    expect(all[0]!.createdAt).toBe(isoAt(11));
    expect(all[all.length - 1]!.createdAt).toBe(isoAt(0));
  });
});
