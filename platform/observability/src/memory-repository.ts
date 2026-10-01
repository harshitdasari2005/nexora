import type { RuntimeRun, RuntimeRunQuery, RuntimeRunRepository } from './contracts.js';

/** In-memory {@link RuntimeRunRepository} (tests, evaluation harness). Append-only, tenant-scoped, deep-copied. */
export class InMemoryRuntimeRunRepository implements RuntimeRunRepository {
  readonly #runs: RuntimeRun[] = [];

  async append(run: RuntimeRun): Promise<void> {
    if (this.#runs.some((r) => r.id === run.id && r.tenantId === run.tenantId)) {
      throw new Error(`runtime run ${run.id} already recorded (runs are immutable)`);
    }
    this.#runs.push(structuredClone(run));
  }

  async list(tenantId: string, query: RuntimeRunQuery = {}): Promise<readonly RuntimeRun[]> {
    const matches = this.#runs
      .filter(
        (r) =>
          r.tenantId === tenantId &&
          (query.workspaceId === undefined || r.workspaceId === query.workspaceId) &&
          (query.status === undefined || r.status === query.status) &&
          (query.failureStage === undefined || r.failure?.stage === query.failureStage) &&
          (query.failureClass === undefined || r.failure?.class === query.failureClass) &&
          (query.provider === undefined || r.provider === query.provider) &&
          (query.model === undefined || r.model === query.model) &&
          (query.agentId === undefined || r.agentId === query.agentId) &&
          (query.actorId === undefined || r.actorId === query.actorId) &&
          (query.origin === undefined || r.origin === query.origin) &&
          (query.requestId === undefined || r.requestId === query.requestId) &&
          (query.approvalId === undefined ||
            r.approval?.approvalId === query.approvalId ||
            r.tools.some((tool) => tool.approvalId === query.approvalId)) &&
          (query.invocationId === undefined ||
            r.tools.some((tool) => tool.invocationId === query.invocationId)) &&
          (query.from === undefined || r.startedAt >= query.from) &&
          (query.to === undefined || r.startedAt <= query.to),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    return matches.slice(0, query.limit ?? 100).map((r) => structuredClone(r));
  }

  async get(tenantId: string, runId: string): Promise<RuntimeRun | undefined> {
    const found = this.#runs.find((r) => r.tenantId === tenantId && r.id === runId);
    return found === undefined ? undefined : structuredClone(found);
  }
}
