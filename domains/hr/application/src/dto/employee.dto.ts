/**
 * @nexora/application-hr — employee DTO.
 *
 * The public representation of an employee returned by queries and APIs.
 * Internal aggregates never cross module boundaries.
 */

import type { Employee } from '@nexora/domain-hr';

/** The public employee representation. */
export interface EmployeeDto {
  /** The employee id. */
  id: string;
  /** The owning organization (tenant) id. */
  organizationId: string;
  /** The name. */
  name: string;
  /** The lifecycle status (`proposed` | `hired` | `onboarding` | `active` | `on_leave` | `exiting` | `offboarded` | `cancelled`). */
  status: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** Maps an {@link Employee} aggregate to its {@link EmployeeDto}. */
export function toEmployeeDto(employee: Employee): EmployeeDto {
  return {
    id: employee.id,
    organizationId: employee.organizationId,
    name: employee.name.value,
    status: employee.status.value,
    createdAt: employee.createdAt,
  };
}
