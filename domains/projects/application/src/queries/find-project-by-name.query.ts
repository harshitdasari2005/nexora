/**
 * @nexora/application-projects — FindProjectByName query.
 *
 * Tenant-scoped project name resolution (CQRS read side; BACKEND.md §8).
 * This is the deterministic resolution used by the AI assignment tooling:
 * it returns every candidate so the caller distinguishes resolved (exactly
 * one) from ambiguous (multiple) — the system never guesses. The
 * organization is the trusted tenant scope, never a model-supplied value.
 */

import type { TenantId } from '@nexora/contracts/common';

import type { ProjectDto } from '../dto/project.dto.js';

/** Resolves projects by name within an organization. */
export interface FindProjectByNameQuery {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The name term (case-insensitive substring match). */
  name: string;
}

/** The result of {@link FindProjectByNameQuery}. */
export type FindProjectByNameResult = readonly ProjectDto[];
