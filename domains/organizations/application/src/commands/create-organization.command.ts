/**
 * @nexora/application-organizations — CreateOrganization command.
 *
 * The onboarding use case that provisions a new organization, activates it,
 * and adds the creating user as the first owner (PSD.md §1; the documented
 * first-owner provisioning flow in docs/AGGREGATES.md).
 */

import type { UserId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Organization } from '@nexora/domain-organizations';
import type { OrganizationMembership } from '@nexora/domain-organizations';

/** Creates and provisions a new organization. */
export interface CreateOrganizationCommand {
  /** The organization name. */
  name: string;
  /** The globally unique slug. */
  slug: string;
  /** The provisioning type (one of the organization types). */
  type: string;
  /** Optional description. */
  description?: string;
  /** The user that creates the organization (becomes the first owner). */
  actorId: UserId;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful organization creation. */
export interface CreateOrganizationResult {
  /** The created (active) organization aggregate. */
  organization: Organization;
  /** The first-owner membership. */
  membership: OrganizationMembership;
  /** Domain events emitted by the use case (created/activated/member_added). */
  events: readonly EventEnvelope[];
}
