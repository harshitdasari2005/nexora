/**
 * @nexora/application-hr — employee listing queries.
 *
 * Read queries over the employee records of an organization (CQRS read
 * side; BACKEND.md §8). All are tenant-scoped: ids outside the organization
 * resolve to nothing, never to foreign records.
 */

import type { TenantId } from '@nexora/contracts/common';

import type { EmployeeDto } from '../dto/employee.dto.js';

/** Loads employees by id within an organization. */
export interface ListEmployeesByIdsQuery {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The employee ids to load. */
  ids: readonly string[];
}

/** The result of {@link ListEmployeesByIdsQuery}. */
export type ListEmployeesByIdsResult = readonly EmployeeDto[];

/** Lists the employees of an organization. */
export interface ListEmployeesQuery {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
}

/** The result of {@link ListEmployeesQuery}. */
export type ListEmployeesResult = readonly EmployeeDto[];
