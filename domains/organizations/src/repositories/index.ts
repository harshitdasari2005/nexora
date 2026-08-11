/**
 * @nexora/domain-organizations — repository interfaces & ports.
 *
 * The persistence contracts the Organizations domain depends on (DDD.md §6,
 * §7; PERSISTENCE.md §4 aggregate ownership). Interfaces only — the
 * infrastructure layer provides implementations. Each aggregate is the
 * transaction boundary: saving an {@link Organization} persists the whole
 * aggregate (profile + settings) atomically.
 */

import type { UserId } from '@nexora/contracts/common';

import type { Organization } from '../entities/organization.js';
import type { OrganizationMembership } from '../entities/organization-membership.js';
import type { OrganizationId } from '../value-objects/organization-id.js';
import type { OrganizationSlug } from '../value-objects/organization-slug.js';

/**
 * Persistence contract for the {@link Organization} aggregate. The aggregate
 * is the transaction boundary: save persists the whole aggregate (profile +
 * settings) atomically.
 */
export interface OrganizationRepository {
  /** Finds an organization by id, or `undefined`. */
  findById(id: OrganizationId): Promise<Organization | undefined>;
  /** Finds an organization by slug, or `undefined`. */
  findBySlug(slug: OrganizationSlug): Promise<Organization | undefined>;
  /**
   * Whether an organization with the slug exists. Slug uniqueness is a
   * domain contract: enforced here through the port and in the
   * infrastructure layer via a unique index (SlugUniquenessPolicy).
   */
  existsBySlug(slug: OrganizationSlug): Promise<boolean>;
  /**
   * Finds several organizations in one query (read-model batch). Used to
   * resolve a user's memberships without N+1 lookups.
   */
  listByIds(ids: readonly OrganizationId[]): Promise<readonly Organization[]>;
  /** Persists the organization aggregate (insert or update). */
  save(organization: Organization): Promise<void>;
}

/**
 * Persistence contract for the {@link OrganizationMembership} aggregate.
 */
export interface MembershipRepository {
  /** Finds a membership by id, or `undefined`. */
  findById(id: string): Promise<OrganizationMembership | undefined>;
  /** Finds the active membership of a user in an organization, or `undefined`. */
  findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMembership | undefined>;
  /** Lists the active memberships of an organization. */
  listByOrganization(organizationId: OrganizationId): Promise<readonly OrganizationMembership[]>;
  /** Lists the memberships of a user across organizations (read model). */
  listByUser(userId: UserId): Promise<readonly OrganizationMembership[]>;
  /** Counts the `owner` memberships of an organization. */
  countOwners(organizationId: OrganizationId): Promise<number>;
  /** Persists the membership aggregate (insert or update). */
  save(membership: OrganizationMembership): Promise<void>;
  /** Removes the membership (hard delete). */
  remove(membership: OrganizationMembership): Promise<void>;
}
