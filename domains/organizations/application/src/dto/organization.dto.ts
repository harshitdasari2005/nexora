/**
 * @nexora/application-organizations — organization DTO.
 *
 * The public representation of an organization returned by queries and
 * APIs. Internal aggregates never cross module boundaries.
 */

import type { Organization } from '@nexora/domain-organizations';

/** The public organization representation. */
export interface OrganizationDto {
  /** The organization (tenant) id. */
  id: string;
  /** The globally unique slug. */
  slug: string;
  /** The name. */
  name: string;
  /** The provisioning type. */
  type: string;
  /** The lifecycle status (`provisioning` | `active` | `suspended` | `archived`). */
  status: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** Maps an {@link Organization} aggregate to its {@link OrganizationDto}. */
export function toOrganizationDto(organization: Organization): OrganizationDto {
  return {
    id: organization.id,
    slug: organization.slug.value,
    name: organization.profile.name.value,
    type: organization.type.value,
    status: organization.status.value,
    createdAt: organization.createdAt,
  };
}
