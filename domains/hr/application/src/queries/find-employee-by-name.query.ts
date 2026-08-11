/**
 * @nexora/application-hr — FindEmployeeByName query.
 *
 * Tenant-scoped employee name resolution (CQRS read side; BACKEND.md §8).
 * This is the deterministic resolution used by the AI assignment tooling:
 * it returns every candidate so the caller distinguishes resolved (exactly
 * one) from ambiguous (multiple) — the system never guesses. The
 * organization is the trusted tenant scope, never a model-supplied value.
 */

import type { TenantId } from '@nexora/contracts/common';

import type { EmployeeDto } from '../dto/employee.dto.js';

/** Resolves employees by name within an organization. */
export interface FindEmployeeByNameQuery {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The name term (case-insensitive substring match). */
  name: string;
}

/** The result of {@link FindEmployeeByNameQuery}. */
export type FindEmployeeByNameResult = readonly EmployeeDto[];
