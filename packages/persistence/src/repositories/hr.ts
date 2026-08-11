/**
 * @nexora/persistence — employees repository.
 *
 * Drizzle implementation of the HR domain repository interface
 * (`EmployeeRepository`). Aggregates are serialized via `snapshot()` and
 * reconstructed via `hydrate()` (PERSISTENCE.md §4 aggregate ownership).
 * Name resolution is a tenant-scoped, case-insensitive substring match so
 * the deterministic AI resolution never sees foreign records.
 */

import { and, eq, ilike } from 'drizzle-orm';
import type { TenantId } from '@nexora/contracts/common';
import type { EmployeeRepository } from '@nexora/domain-hr';
import { Employee, EmployeeId, EmployeeName, EmployeeStatus } from '@nexora/domain-hr';

import type { NexoraDatabase } from '../db.js';
import { employees } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

type EmployeeRow = typeof employees.$inferSelect;

/** Maps an employees row to a {@link Employee} snapshot. */
function rowToEmployeeSnapshot(row: EmployeeRow): ReturnType<typeof Employee.snapshot> {
  return {
    id: EmployeeId.from(row.id),
    organizationId: row.organizationId as TenantId,
    name: EmployeeName.create(row.name).value,
    status: EmployeeStatus.from(row.status).value,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Maps an {@link Employee} snapshot to an employees row. */
function employeeSnapshotToRow(snapshot: ReturnType<typeof Employee.snapshot>): EmployeeRow {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    name: snapshot.name,
    status: snapshot.status,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link EmployeeRepository} implementation. */
export class PgEmployeeRepository implements EmployeeRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: EmployeeId): Promise<Employee | undefined> {
    const row = await this.#db.query.employees.findFirst({
      where: eq(employees.id, id),
    });
    return row === undefined ? undefined : Employee.hydrate(rowToEmployeeSnapshot(row));
  }

  async findByName(organizationId: TenantId, name: string): Promise<readonly Employee[]> {
    const term = name.trim();
    if (term.length === 0) {
      return [];
    }
    const rows = await this.#db.query.employees.findMany({
      where: and(
        eq(employees.organizationId, organizationId),
        // Case-insensitive substring match (ilike on the raw column).
        ilike(employees.name, `%${term}%`),
      ),
      // Deterministic order: oldest first keeps resolution stable.
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });
    return rows.map((row) => Employee.hydrate(rowToEmployeeSnapshot(row)));
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly Employee[]> {
    const rows = await this.#db.query.employees.findMany({
      where: eq(employees.organizationId, organizationId),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });
    return rows.map((row) => Employee.hydrate(rowToEmployeeSnapshot(row)));
  }

  async save(employee: Employee): Promise<void> {
    const row = employeeSnapshotToRow(Employee.snapshot(employee));
    await this.#db
      .insert(employees)
      .values(row)
      .onConflictDoUpdate({ target: employees.id, set: row });
  }
}
