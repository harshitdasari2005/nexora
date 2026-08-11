/**
 * @nexora/application-organizations — ListOrganizations query.
 *
 * Lists the organizations a user belongs to (CQRS read side; BACKEND.md §8).
 */

import type { UserId } from '@nexora/contracts/common';

import type { OrganizationDto } from '../dto/organization.dto.js';

/** Lists the organizations of a user. */
export interface ListOrganizationsQuery {
  /** The user id. */
  userId: UserId;
}

/** The result of {@link ListOrganizationsQuery}. */
export type ListOrganizationsResult = readonly OrganizationDto[];
