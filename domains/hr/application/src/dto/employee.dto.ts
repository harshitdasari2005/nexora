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
  /** Work/contact email, when known. */
  email?: string;
  jobTitle?: string;
  department?: string;
  employmentType?: string;
  /** The agreed start date (`YYYY-MM-DD`), when known. */
  startDate?: string;
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
    ...publicProfile(employee),
    createdAt: employee.createdAt,
  };
}

/** The profile fields the DTO exposes (the internal requisition link stays internal). */
function publicProfile(
  employee: Employee,
): Pick<EmployeeDto, 'email' | 'jobTitle' | 'department' | 'employmentType' | 'startDate'> {
  const profile = employee.profile;
  if (profile === undefined) return {};
  return {
    ...(profile.email === undefined ? {} : { email: profile.email }),
    ...(profile.jobTitle === undefined ? {} : { jobTitle: profile.jobTitle }),
    ...(profile.department === undefined ? {} : { department: profile.department }),
    ...(profile.employmentType === undefined ? {} : { employmentType: profile.employmentType }),
    ...(profile.startDate === undefined ? {} : { startDate: profile.startDate }),
  };
}
