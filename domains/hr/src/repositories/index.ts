/**
 * @nexora/domain-hr — repository interfaces.
 *
 * The persistence ports of the HR bounded context (BACKEND.md §2 dependency
 * direction; PERSISTENCE.md §4 aggregate ownership). The domain depends on
 * these interfaces; the infrastructure layer (PostgreSQL/Drizzle) implements
 * them. No ORM, no SQL, no persistence here.
 */

import type { TenantId } from '@nexora/contracts/common';

import type { Employee } from '../entities/employee.js';
import type { EmployeeId } from '../value-objects/employee-id.js';

/**
 * The persistence port of the {@link Employee} aggregate.
 */
export interface EmployeeRepository {
  /** Loads an employee by id, or `undefined` when it does not exist. */
  findById(id: EmployeeId): Promise<Employee | undefined>;

  /**
   * Finds employees whose name matches the given term within an
   * organization (tenant-scoped, case-insensitive substring match). Used by
   * the deterministic name resolution used by the AI tooling (no guessing).
   */
  findByName(organizationId: TenantId, name: string): Promise<readonly Employee[]>;

  /** Lists the employees of an organization (tenant-scoped read). */
  listByOrganization(organizationId: TenantId): Promise<readonly Employee[]>;

  /** Persists the aggregate (insert or update by id). */
  save(employee: Employee): Promise<void>;
}
