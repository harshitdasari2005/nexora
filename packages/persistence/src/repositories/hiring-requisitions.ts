/**
 * @nexora/persistence — hiring requisitions repository.
 *
 * Drizzle implementation of the HR domain's `HiringRequisitionRepository`.
 * Updates are optimistic: the row is written only while it is still at the
 * version the aggregate was loaded at, so two concurrent decisions (or a
 * decision racing an edit) cannot both win.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import {
  HiringRequisition,
  RequisitionId,
  type HiringRequisitionRepository,
  type HiringRequisitionSnapshot,
  type RequisitionHistoryEntry,
} from '@nexora/domain-hr';

import type { NexoraDatabase } from '../db.js';
import { hiringRequisitions } from '../schema/index.js';

type Row = typeof hiringRequisitions.$inferSelect;

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

function rowToSnapshot(row: Row): HiringRequisitionSnapshot {
  return {
    id: RequisitionId.from(row.id),
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    requestedBy: row.requestedBy,
    jobTitle: row.jobTitle,
    department: row.department,
    ...(row.projectId === null ? {} : { projectId: row.projectId }),
    headcount: row.headcount,
    employmentType: row.employmentType as HiringRequisitionSnapshot['employmentType'],
    salaryMinMinorUnits: row.salaryMinMinorUnits,
    salaryMaxMinorUnits: row.salaryMaxMinorUnits,
    currency: row.currency,
    justification: row.justification,
    urgency: row.urgency as HiringRequisitionSnapshot['urgency'],
    ...(row.targetStartDate === null ? {} : { targetStartDate: row.targetStartDate }),
    status: row.status as HiringRequisitionSnapshot['status'],
    round: row.round,
    history: row.history as RequisitionHistoryEntry[],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

function snapshotToRow(snapshot: HiringRequisitionSnapshot): Row {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    workspaceId: snapshot.workspaceId,
    requestedBy: snapshot.requestedBy,
    jobTitle: snapshot.jobTitle,
    department: snapshot.department,
    projectId: snapshot.projectId ?? null,
    headcount: snapshot.headcount,
    employmentType: snapshot.employmentType,
    salaryMinMinorUnits: snapshot.salaryMinMinorUnits,
    salaryMaxMinorUnits: snapshot.salaryMaxMinorUnits,
    currency: snapshot.currency,
    justification: snapshot.justification,
    urgency: snapshot.urgency,
    targetStartDate: snapshot.targetStartDate ?? null,
    status: snapshot.status,
    round: snapshot.round,
    history: [...snapshot.history],
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link HiringRequisitionRepository} implementation. */
export class PgHiringRequisitionRepository implements HiringRequisitionRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: RequisitionId): Promise<HiringRequisition | undefined> {
    const rows = await this.#db
      .select()
      .from(hiringRequisitions)
      .where(eq(hiringRequisitions.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : HiringRequisition.hydrate(rowToSnapshot(row));
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly HiringRequisition[]> {
    const rows = await this.#db
      .select()
      .from(hiringRequisitions)
      .where(eq(hiringRequisitions.organizationId, organizationId))
      .orderBy(desc(hiringRequisitions.createdAt), desc(hiringRequisitions.id));
    return rows.map((row) => HiringRequisition.hydrate(rowToSnapshot(row)));
  }

  async insert(requisition: HiringRequisition): Promise<void> {
    await this.#db
      .insert(hiringRequisitions)
      .values(snapshotToRow(HiringRequisition.snapshot(requisition)));
  }

  async update(requisition: HiringRequisition, expectedVersion: number): Promise<boolean> {
    const row = snapshotToRow(HiringRequisition.snapshot(requisition));
    // Only what a requisition may change: identity and scope columns (id,
    // organization, workspace, requester, created_at) are never rewritten.
    const mutable = {
      jobTitle: row.jobTitle,
      department: row.department,
      projectId: row.projectId,
      headcount: row.headcount,
      employmentType: row.employmentType,
      salaryMinMinorUnits: row.salaryMinMinorUnits,
      salaryMaxMinorUnits: row.salaryMaxMinorUnits,
      currency: row.currency,
      justification: row.justification,
      urgency: row.urgency,
      targetStartDate: row.targetStartDate,
      status: row.status,
      round: row.round,
      history: row.history,
      updatedAt: row.updatedAt,
      version: row.version,
    };
    const updated = await this.#db
      .update(hiringRequisitions)
      .set(mutable)
      .where(
        and(
          eq(hiringRequisitions.id, requisition.id),
          eq(hiringRequisitions.organizationId, requisition.organizationId),
          eq(hiringRequisitions.version, expectedVersion),
        ),
      )
      .returning({ id: hiringRequisitions.id });
    return updated.length === 1;
  }
}
