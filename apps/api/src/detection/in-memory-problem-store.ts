/**
 * @nexora/app-api — in-memory business-problem store (S27).
 *
 * The ephemeral {@link ProblemStore} used when no database is available
 * (tests, local dev without PostgreSQL). Mirrors the PostgreSQL store's
 * scoping contract exactly: reads are always tenant + workspace scoped, so
 * a forged problem id from another tenant or workspace resolves to nothing
 * (fail closed). Problems are process-local — durability requires the
 * PostgreSQL store.
 */

import type { ProblemStore } from '@nexora/module-detection';
import type { BusinessProblemSnapshot } from '@nexora/module-detection';

/** The in-memory {@link ProblemStore}. */
export class InMemoryProblemStore implements ProblemStore {
  readonly problems = new Map<string, BusinessProblemSnapshot>();

  async save(problem: BusinessProblemSnapshot): Promise<void> {
    this.problems.set(problem.id, problem);
  }

  async findById(tenantId: string, problemId: string) {
    const record = this.problems.get(problemId);
    return record === undefined || record.tenantId !== tenantId ? undefined : record;
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
