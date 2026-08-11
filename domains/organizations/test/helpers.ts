/**
 * In-memory repository fakes and test builders for the organizations domain
 * tests. These implement the domain repository interfaces without
 * persistence; they are test-only and never shipped.
 */

import type { UserId } from '@nexora/contracts/common';

import type { Organization } from '../src/entities/organization.js';
import type { OrganizationMembership } from '../src/entities/organization-membership.js';
import type { MembershipRepository, OrganizationRepository } from '../src/repositories/index.js';
import type { OrganizationId } from '../src/value-objects/organization-id.js';
import type { OrganizationSlug } from '../src/value-objects/organization-slug.js';
import type { OrganizationEventContext } from '../src/events/index.js';

/** An in-memory {@link OrganizationRepository}. */
export class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly organizations = new Map<string, Organization>();
  readonly bySlug = new Map<string, Organization>();

  async findById(id: OrganizationId): Promise<Organization | undefined> {
    return this.organizations.get(id);
  }

  async findBySlug(slug: OrganizationSlug): Promise<Organization | undefined> {
    return this.bySlug.get(slug.value);
  }

  async existsBySlug(slug: OrganizationSlug): Promise<boolean> {
    return this.bySlug.has(slug.value);
  }

  async listByIds(ids: readonly OrganizationId[]): Promise<readonly Organization[]> {
    return ids
      .map((id) => this.organizations.get(id))
      .filter((organization): organization is Organization => organization !== undefined);
  }

  async save(organization: Organization): Promise<void> {
    this.organizations.set(organization.id, organization);
    this.bySlug.set(organization.slug.value, organization);
  }
}

/** An in-memory {@link MembershipRepository}. */
export class InMemoryMembershipRepository implements MembershipRepository {
  readonly memberships = new Map<string, OrganizationMembership>();
  readonly byOrganizationAndUser = new Map<string, OrganizationMembership>();

  async findById(id: string): Promise<OrganizationMembership | undefined> {
    return this.memberships.get(id);
  }

  async findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMembership | undefined> {
    return this.byOrganizationAndUser.get(`${organizationId}:${userId}`);
  }

  async listByOrganization(
    organizationId: OrganizationId,
  ): Promise<readonly OrganizationMembership[]> {
    return [...this.memberships.values()].filter(
      (membership) => membership.organizationId === organizationId,
    );
  }

  async listByUser(userId: UserId): Promise<readonly OrganizationMembership[]> {
    return [...this.memberships.values()].filter((membership) => membership.userId === userId);
  }

  async countOwners(organizationId: OrganizationId): Promise<number> {
    const members = await this.listByOrganization(organizationId);
    return members.filter((membership) => membership.isOwner()).length;
  }

  async save(membership: OrganizationMembership): Promise<void> {
    this.memberships.set(membership.id, membership);
    this.byOrganizationAndUser.set(`${membership.organizationId}:${membership.userId}`, membership);
  }

  async remove(membership: OrganizationMembership): Promise<void> {
    this.memberships.delete(membership.id);
    this.byOrganizationAndUser.delete(`${membership.organizationId}:${membership.userId}`);
  }
}

/** A reusable event context for tests. */
export function testContext(
  overrides: Partial<OrganizationEventContext> = {},
): OrganizationEventContext {
  return {
    actor: { kind: 'user', id: 'usr_system' },
    correlationId: 'corr_test',
    ...overrides,
  };
}
