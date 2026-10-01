/**
 * @nexora/module-detection — detection application service tests (S27).
 *
 * S27 §20: scan → problem → investigate → discover → recommend; duplicate
 * detection prevention (correlation dedupe); honest resolution on
 * re-evaluation; fail-closed action proposals bounded by the caller's agent
 * capability set.
 */

import { describe, expect, it } from 'vitest';

import {
  DetectionApplicationService,
  type DetectionScope,
} from '../src/application/detection-application-service.js';
import { InvestigationEngine } from '../src/application/investigation-engine.js';
import { SolutionDiscovery } from '../src/application/solution-discovery.js';
import { BusinessSignalRegistry } from '../src/registry/business-signal-registry.js';
import { INITIAL_SIGNALS } from '../src/seed/initial-signals.js';
import {
  emptySnapshot,
  fixedSnapshotLoader,
  fixedSolutionSources,
  InMemoryProblemStore,
  workflowMetric,
} from './helpers.js';

const scope: DetectionScope = {
  userId: 'usr_alex',
  tenantId: 'org_tenant_a',
  workspaceId: 'ws_dev',
  agentCapabilityIds: [
    'workflow.retry_run',
    'projects.find_project',
    'notifications.what_needs_attention',
  ],
};

function buildService(options: {
  snapshot: ReturnType<typeof emptySnapshot>;
  store?: InMemoryProblemStore;
  agentCapabilityIds?: readonly string[];
  knowledge?: Parameters<typeof fixedSolutionSources>[0]['knowledge'];
}): { service: DetectionApplicationService; store: InMemoryProblemStore } {
  const store = options.store ?? new InMemoryProblemStore();
  const registry = new BusinessSignalRegistry();
  for (const def of INITIAL_SIGNALS) {
    registry.register(def);
  }
  const service = new DetectionApplicationService({
    registry,
    snapshotLoader: fixedSnapshotLoader(options.snapshot),
    investigation: new InvestigationEngine(),
    discovery: new SolutionDiscovery(fixedSolutionSources({ knowledge: options.knowledge })),
    store,
  });
  return { service, store };
}

describe('DetectionApplicationService', () => {
  it('detects, investigates, and recommends for the trusted scope', async () => {
    const { service, store } = buildService({
      snapshot: emptySnapshot({
        workspaceId: 'ws_dev',
        workflowHealth: [workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 6 })],
        activity: [
          {
            id: 'act_1',
            type: 'workflow.failed',
            title: 'wf_auth failed',
            occurredAt: '2026-08-16T11:46:00.000Z',
          },
        ],
      }),
    });
    const result = await service.scan(scope);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const problem = result.problems.find((p) => p.signalId === 'workflow_failure');
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe('high');
    expect(problem?.status).toBe('DETECTED');
    expect(problem?.evidence.length).toBeGreaterThan(0);
    expect(problem?.rootCauses.some((cause) => cause.kind === 'FACT')).toBe(true);
    // No known solution in this snapshot → the engine says so explicitly.
    expect(problem?.recommendation?.summary).toContain('No known solution found');
    expect(problem?.recommendation?.actionProposal).toBeUndefined();
    expect(store.problems.size).toBeGreaterThan(0);
  });

  it('never creates duplicates for a repeatedly-detected condition (dedupe)', async () => {
    const snapshot = emptySnapshot({
      workspaceId: 'ws_dev',
      workflowHealth: [workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 6 })],
    });
    const { service, store } = buildService({ snapshot });
    await service.scan(scope);
    await service.scan(scope);
    await service.scan(scope);

    const failures = [...store.problems.values()].filter(
      (record) => record.signalId === 'workflow_failure',
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.status).toBe('DETECTED');
  });

  it('resolves a problem honestly when re-evaluation shows the condition is gone', async () => {
    const failing = emptySnapshot({
      workspaceId: 'ws_dev',
      workflowHealth: [workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 6 })],
    });
    const { service, store } = buildService({ snapshot: failing });
    await service.scan(scope);
    expect([...store.problems.values()][0]?.status).toBe('DETECTED');

    // The workflow recovers: the next scan must resolve the open problem.
    const healthy = emptySnapshot({
      workspaceId: 'ws_dev',
      workflowHealth: [
        workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 0, successRate: 100 }),
      ],
    });
    const service2 = buildService({ snapshot: healthy, store }).service;
    const result = await service2.scan(scope);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const problem = result.problems.find((p) => p.signalId === 'workflow_failure');
    expect(problem?.status).toBe('RESOLVED');
  });

  it('re-opens a resolved problem when the condition fires again (new episode)', async () => {
    const failing = emptySnapshot({
      workspaceId: 'ws_dev',
      workflowHealth: [workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 6 })],
    });
    const { service, store } = buildService({ snapshot: failing });
    await service.scan(scope);

    const healthy = emptySnapshot({
      workspaceId: 'ws_dev',
      workflowHealth: [
        workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 0, successRate: 100 }),
      ],
    });
    const service2 = buildService({ snapshot: healthy, store }).service;
    const resolved = await service2.scan(scope);
    expect(
      resolved.ok && resolved.problems.find((p) => p.signalId === 'workflow_failure')?.status,
    ).toBe('RESOLVED');

    const service3 = buildService({ snapshot: failing, store }).service;
    const reopened = await service3.scan(scope);
    expect(
      reopened.ok && reopened.problems.find((p) => p.signalId === 'workflow_failure')?.status,
    ).toBe('DETECTED');
    const records = [...store.problems.values()].filter((r) => r.signalId === 'workflow_failure');
    expect(records).toHaveLength(1);
  });

  it('produces a governed action proposal only when the remediation capability is in the caller agent set', async () => {
    const snapshot = emptySnapshot({
      workspaceId: 'ws_dev',
      workflowHealth: [workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 6 })],
    });
    const knowledge = [
      {
        sourceId: 'kno_auth017',
        title: 'AUTH-017 Authentication correction',
        snippet: 'When wf_auth fails, correct the authentication configuration.',
        kind: 'article',
      },
    ];
    // The caller HAS workflow.retry_run → the proposal exists, grounded in
    // the known applicable solution.
    const { service } = buildService({ snapshot, knowledge });
    const result = await service.scan(scope);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const withCapability = result.problems.find((p) => p.signalId === 'workflow_failure');
    expect(withCapability?.recommendation?.summary).toContain('Known solution found');
    expect(withCapability?.recommendation?.actionProposal).toBeDefined();
    expect(withCapability?.recommendation?.actionProposal?.requiredCapability).toBe(
      'workflow.retry_run',
    );
    expect(withCapability?.recommendation?.actionProposal?.requiresApproval).toBe(true);

    // A caller WITHOUT the capability gets the recommendation but no proposal
    // (fail closed — an agent is never recommended to act beyond its set).
    const { service: service2 } = buildService({ snapshot, knowledge });
    const result2 = await service2.scan({
      ...scope,
      agentCapabilityIds: ['projects.find_project'],
    });
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    const withoutCapability = result2.problems.find((p) => p.signalId === 'workflow_failure');
    expect(withoutCapability?.recommendation?.summary).toContain('Known solution found');
    expect(withoutCapability?.recommendation?.actionProposal).toBeUndefined();
  });

  it('isolates problems by tenant and workspace (forged ids resolve to nothing)', async () => {
    const { service, store } = buildService({
      snapshot: emptySnapshot({
        workspaceId: 'ws_dev',
        workflowHealth: [workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 6 })],
      }),
    });
    await service.scan(scope);
    const [record] = [...store.problems.values()];
    expect(record).toBeDefined();

    // Same tenant, different workspace → not visible.
    const otherWorkspace = await service.list({ ...scope, workspaceId: 'ws_other' });
    expect(otherWorkspace).toHaveLength(0);

    // Different tenant, forged problem id → undefined.
    const forged = await service.getById(
      { ...scope, tenantId: 'org_other' },
      record?.id ?? 'prb_x',
    );
    expect(forged).toBeUndefined();
  });
});

describe('DetectionApplicationService — workspace scope (tenant-isolation audit F-001)', () => {
  // The store contract only filters by tenant (like the PostgreSQL store), so
  // the SERVICE must enforce the workspace: a foreign-workspace problem id
  // resolves exactly like a missing one and is never mutated.
  const failing = (workspaceId: string) =>
    emptySnapshot({
      workspaceId,
      workflowHealth: [workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 6 })],
    });
  const wsA: DetectionScope = { ...scope, workspaceId: 'ws_a' };
  const wsB: DetectionScope = { ...scope, workspaceId: 'ws_b' };
  const orgLevel: DetectionScope = { ...scope, workspaceId: undefined };
  const otherTenant: DetectionScope = { ...wsA, tenantId: 'org_tenant_b' };

  async function seed() {
    const store = new InMemoryProblemStore();
    const idOf = async (s: DetectionScope, workspaceId: string) => {
      const { service } = buildService({ snapshot: failing(workspaceId), store });
      const result = await service.scan(s);
      expect(result.ok).toBe(true);
      const problem = result.ok
        ? result.problems.find((p) => p.signalId === 'workflow_failure')
        : undefined;
      expect(problem).toBeDefined();
      return problem?.id as string;
    };
    const idA = await idOf(wsA, 'ws_a');
    const idB = await idOf(wsB, 'ws_b');
    const { service } = buildService({ snapshot: failing('ws_a'), store });
    return { service, store, idA, idB };
  }

  it('getById resolves only inside the owning workspace', async () => {
    const { service, idA, idB } = await seed();
    expect((await service.getById(wsA, idA))?.id).toBe(idA);
    expect(await service.getById(wsB, idA)).toBeUndefined();
    expect(await service.getById(orgLevel, idA)).toBeUndefined();
    expect(await service.getById(otherTenant, idA)).toBeUndefined();
    expect((await service.getById(wsB, idB))?.id).toBe(idB);
  });

  it('reevaluate never evaluates (or returns) a foreign-workspace problem', async () => {
    const { service, idA } = await seed();
    expect(await service.reevaluate(wsB, idA)).toBeUndefined();
    expect((await service.reevaluate(wsA, idA))?.problem.id).toBe(idA);
  });

  it('transition refuses a foreign-workspace problem and leaves it untouched', async () => {
    const { service, store, idA } = await seed();
    const before = store.problems.get(idA);
    expect(await service.transition(wsB, idA, 'RESOLVED', '2026-08-16T13:00:00.000Z')).toBe(false);
    expect(await service.transition(orgLevel, idA, 'RESOLVED', '2026-08-16T13:00:00.000Z')).toBe(
      false,
    );
    expect(store.problems.get(idA)).toEqual(before);
    // Control: the owning workspace may transition it.
    expect(await service.transition(wsA, idA, 'INVESTIGATING', '2026-08-16T13:00:00.000Z')).toBe(
      true,
    );
    expect(store.problems.get(idA)?.status).toBe('INVESTIGATING');
  });

  it('listByIds omits problems that belong to another workspace', async () => {
    const { service, idA, idB } = await seed();
    const listed = await service.listByIds(wsA, [idA, idB]);
    expect(listed.map((p) => p.id)).toEqual([idA]);
  });
});
