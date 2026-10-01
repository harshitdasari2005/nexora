import type { LineageQuery, LineageRecord, LineageRepository } from './contracts.js';

/** In-memory {@link LineageRepository} (tests, evaluation harness). Append-only. */
export class InMemoryLineageRepository implements LineageRepository {
  readonly #records: LineageRecord[] = [];

  async append(records: readonly LineageRecord[]): Promise<void> {
    for (const record of records) {
      // Deep copy: what is stored can never be mutated through a caller's reference.
      this.#records.push(structuredClone(record));
    }
  }

  async list(tenantId: string, query: LineageQuery = {}): Promise<readonly LineageRecord[]> {
    const matches = this.#records
      .filter(
        (r) =>
          r.tenantId === tenantId &&
          (query.workspaceId === undefined || r.workspaceId === query.workspaceId) &&
          (query.kind === undefined || r.kind === query.kind) &&
          (query.subjectType === undefined || r.subjectType === query.subjectType) &&
          (query.subjectId === undefined || r.subjectId === query.subjectId) &&
          (query.runId === undefined || r.runId === query.runId) &&
          (query.approvalId === undefined || r.approvalId === query.approvalId) &&
          (query.invocationId === undefined || r.invocationId === query.invocationId),
      )
      .sort(
        (a, b) =>
          a.occurredAt.localeCompare(b.occurredAt) || a.seq - b.seq || a.id.localeCompare(b.id),
      );
    const limited = query.limit === undefined ? matches : matches.slice(0, query.limit);
    return limited.map((r) => structuredClone(r));
  }
}
