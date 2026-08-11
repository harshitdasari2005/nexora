/**
 * @nexora/persistence — resource assignments repository.
 *
 * Drizzle implementation of the Projects domain repository interface
 * (`ResourceAssignmentRepository`). Aggregates are serialized via
 * `snapshot()` and reconstructed via `hydrate()` (PERSISTENCE.md §4
 * aggregate ownership). The unique (project, employee) constraint backs the
 * duplicate-assignment invariant at the database as well as the domain.
 */

import { and, eq } from 'drizzle-orm';
import type { TenantId } from '@nexora/contracts/common';
import type { ResourceAssignmentRepository } from '@nexora/domain-projects';
import { AssignmentId, ProjectId, ResourceAssignment } from '@nexora/domain-projects';

import type { NexoraDatabase } from '../db.js';
import { resourceAssignments } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

type AssignmentRow = typeof resourceAssignments.$inferSelect;

/** Maps a resource_assignments row to a {@link ResourceAssignment} snapshot. */
function rowToAssignmentSnapshot(
  row: AssignmentRow,
): ReturnType<typeof ResourceAssignment.snapshot> {
  return {
    id: AssignmentId.from(row.id),
    projectId: ProjectId.from(row.projectId),
    employeeId: row.employeeId,
    organizationId: row.organizationId as TenantId,
    assignedAt: toIso(row.assignedAt),
    version: row.version,
  };
}

/** Maps a {@link ResourceAssignment} snapshot to a resource_assignments row. */
function assignmentSnapshotToRow(
  snapshot: ReturnType<typeof ResourceAssignment.snapshot>,
): AssignmentRow {
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    employeeId: snapshot.employeeId,
    organizationId: snapshot.organizationId,
    assignedAt: toDate(snapshot.assignedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link ResourceAssignmentRepository} implementation. */
export class PgResourceAssignmentRepository implements ResourceAssignmentRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: AssignmentId): Promise<ResourceAssignment | undefined> {
    const row = await this.#db.query.resourceAssignments.findFirst({
      where: eq(resourceAssignments.id, id),
    });
    return row === undefined ? undefined : ResourceAssignment.hydrate(rowToAssignmentSnapshot(row));
  }

  async findByProjectAndEmployee(
    projectId: ProjectId,
    employeeId: string,
  ): Promise<ResourceAssignment | undefined> {
    const row = await this.#db.query.resourceAssignments.findFirst({
      where: and(
        eq(resourceAssignments.projectId, projectId),
        eq(resourceAssignments.employeeId, employeeId),
      ),
    });
    return row === undefined ? undefined : ResourceAssignment.hydrate(rowToAssignmentSnapshot(row));
  }

  async listByProject(projectId: ProjectId): Promise<readonly ResourceAssignment[]> {
    const rows = await this.#db.query.resourceAssignments.findMany({
      where: eq(resourceAssignments.projectId, projectId),
      orderBy: (table, { asc }) => [asc(table.assignedAt), asc(table.id)],
    });
    return rows.map((row) => ResourceAssignment.hydrate(rowToAssignmentSnapshot(row)));
  }

  async save(assignment: ResourceAssignment): Promise<void> {
    const row = assignmentSnapshotToRow(ResourceAssignment.snapshot(assignment));
    await this.#db
      .insert(resourceAssignments)
      .values(row)
      .onConflictDoUpdate({ target: resourceAssignments.id, set: row });
  }
}
