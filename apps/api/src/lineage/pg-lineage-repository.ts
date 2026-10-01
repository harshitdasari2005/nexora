/**
 * @nexora/app-api — PostgreSQL lineage repository (Prompt 6).
 *
 * INSERT-ONLY: there is no update or delete path, so history can never be
 * rewritten. Every read is tenant-scoped; the workspace filter narrows further.
 */

import { and, asc, eq, type SQL } from 'drizzle-orm';
import { lineageRecords, type NexoraDatabase } from '@nexora/persistence';
import type {
  LineageKind,
  LineageQuery,
  LineageRecord,
  LineageRepository,
} from '@nexora/module-lineage';

type Row = typeof lineageRecords.$inferSelect;

function toRecord(row: Row): LineageRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    ...(row.workspaceId === null ? {} : { workspaceId: row.workspaceId }),
    runId: row.runId,
    kind: row.kind as LineageKind,
    occurredAt:
      row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt),
    seq: row.seq,
    ...(row.actorId === null ? {} : { actorId: row.actorId }),
    ...(row.agentId === null ? {} : { agentId: row.agentId }),
    ...(row.delegationId === null ? {} : { delegationId: row.delegationId }),
    ...(row.approvalId === null ? {} : { approvalId: row.approvalId }),
    ...(row.invocationId === null ? {} : { invocationId: row.invocationId }),
    ...(row.subjectType === null ? {} : { subjectType: row.subjectType }),
    ...(row.subjectId === null ? {} : { subjectId: row.subjectId }),
    ...(row.fingerprint === null ? {} : { fingerprint: row.fingerprint }),
    data: row.data as Record<string, unknown>,
  };
}

/** PostgreSQL {@link LineageRepository}. */
export class PgLineageRepository implements LineageRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async append(records: readonly LineageRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.#db.insert(lineageRecords).values(
      records.map((record) => ({
        id: record.id,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId ?? null,
        runId: record.runId,
        kind: record.kind,
        occurredAt: new Date(record.occurredAt),
        seq: record.seq,
        actorId: record.actorId ?? null,
        agentId: record.agentId ?? null,
        delegationId: record.delegationId ?? null,
        approvalId: record.approvalId ?? null,
        invocationId: record.invocationId ?? null,
        subjectType: record.subjectType ?? null,
        subjectId: record.subjectId ?? null,
        fingerprint: record.fingerprint ?? null,
        data: record.data as never,
      })),
    );
  }

  async list(tenantId: string, query: LineageQuery = {}): Promise<readonly LineageRecord[]> {
    const conditions: SQL[] = [eq(lineageRecords.tenantId, tenantId)];
    if (query.workspaceId !== undefined)
      conditions.push(eq(lineageRecords.workspaceId, query.workspaceId));
    if (query.kind !== undefined) conditions.push(eq(lineageRecords.kind, query.kind));
    if (query.subjectType !== undefined)
      conditions.push(eq(lineageRecords.subjectType, query.subjectType));
    if (query.subjectId !== undefined)
      conditions.push(eq(lineageRecords.subjectId, query.subjectId));
    if (query.runId !== undefined) conditions.push(eq(lineageRecords.runId, query.runId));
    if (query.approvalId !== undefined)
      conditions.push(eq(lineageRecords.approvalId, query.approvalId));
    if (query.invocationId !== undefined)
      conditions.push(eq(lineageRecords.invocationId, query.invocationId));
    const base = this.#db
      .select()
      .from(lineageRecords)
      .where(and(...conditions))
      .orderBy(asc(lineageRecords.occurredAt), asc(lineageRecords.seq), asc(lineageRecords.id));
    const rows = query.limit === undefined ? await base : await base.limit(query.limit);
    return rows.map(toRecord);
  }
}
