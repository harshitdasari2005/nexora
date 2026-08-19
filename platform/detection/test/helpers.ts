/**
 * @nexora/module-detection — in-memory test doubles (S27).
 */

import type {
  DetectionSnapshot,
  DetectionSnapshotLoader,
} from '../src/application/detection-snapshot.js';
import type {
  ExecutionSolutionReference,
  KnowledgeSolutionReference,
  SolutionSources,
} from '../src/application/solution-discovery.js';
import type { BusinessProblemSnapshot, ProblemAffectedEntity } from '../src/domain/problem.js';
import type { ProblemStore } from '../src/application/problem-store.js';

/** Builds a baseline (empty) trusted snapshot for a scope. */
export function emptySnapshot(overrides: Partial<DetectionSnapshot> = {}): DetectionSnapshot {
  return {
    tenantId: 'org_tenant_a',
    userId: 'usr_alex',
    generatedAt: '2026-08-16T12:00:00.000Z',
    workflowHealth: [],
    onboarding: [],
    projects: [],
    notifications: [],
    activity: [],
    agentExecutions: [],
    ...overrides,
  };
}

/** A snapshot loader backed by a fixed snapshot. */
export function fixedSnapshotLoader(snapshot: DetectionSnapshot): DetectionSnapshotLoader {
  return {
    async load() {
      return snapshot;
    },
  };
}

/** An in-memory problem store (mirrors the SQL scoping contract). */
export class InMemoryProblemStore implements ProblemStore {
  readonly problems = new Map<string, BusinessProblemSnapshot>();

  async save(problem: BusinessProblemSnapshot): Promise<void> {
    this.problems.set(problem.id, problem);
  }

  async findById(tenantId: string, problemId: string) {
    const record = this.problems.get(problemId);
    return record === undefined || record.tenantId !== tenantId ? undefined : record;
  }

  async findByIds(tenantId: string, problemIds: readonly string[]) {
    return problemIds
      .map((problemId) => this.problems.get(problemId))
      .filter(
        (record): record is BusinessProblemSnapshot =>
          record !== undefined && record.tenantId === tenantId,
      );
  }

  async findByCorrelationId(input: { tenantId: string; correlationId: string }) {
    for (const record of this.problems.values()) {
      if (record.tenantId === input.tenantId && record.correlationId === input.correlationId) {
        return record;
      }
    }
    return undefined;
  }

  async listByScope(scope: { tenantId: string; workspaceId?: string; limit: number }) {
    const records = [...this.problems.values()].filter(
      (record) => record.tenantId === scope.tenantId && record.workspaceId === scope.workspaceId,
    );
    return records.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)).slice(0, scope.limit);
  }
}

/** A solution-discovery port backed by fixed references. */
export function fixedSolutionSources(
  overrides: {
    knowledge?: readonly KnowledgeSolutionReference[];
    executions?: readonly ExecutionSolutionReference[];
  } = {},
): SolutionSources {
  return {
    async searchKnowledge() {
      return overrides.knowledge ?? [];
    },
    async listExecutions() {
      return overrides.executions ?? [];
    },
  };
}

/** A workflow-health metric helper. */
export function workflowMetric(overrides: {
  definitionKey: string;
  total: number;
  failed: number;
  successRate?: number;
  unrecoverableErrorRate?: number;
}): DetectionSnapshot['workflowHealth'][number] {
  const total = overrides.total;
  const failed = overrides.failed;
  return {
    definitionKey: overrides.definitionKey,
    total,
    failed,
    successRate: overrides.successRate ?? ((total - failed) / total) * 100,
    unrecoverableErrorRate: overrides.unrecoverableErrorRate ?? (failed / total) * 100,
    cycleTimeP95Ms: null,
  };
}

/** An affected-entity helper. */
export function entity(overrides: Partial<ProblemAffectedEntity> = {}): ProblemAffectedEntity {
  return { type: 'workflow', id: 'wf_auth', title: 'wf_auth', ...overrides };
}
