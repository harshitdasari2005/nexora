/**
 * Test-only fakes for the organizations application layer: in-memory
 * repository implementations and a recording {@link EventPublisher}.
 */

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import type { UserId } from '@nexora/contracts/common';

import type {
  MembershipRepository,
  OrganizationRepository,
  Organization,
  OrganizationMembership,
} from '@nexora/domain-organizations';
import type { OrganizationId } from '@nexora/domain-organizations';
import type { OrganizationSlug } from '@nexora/domain-organizations';

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

  async findById(id: string): Promise<OrganizationMembership | undefined> {
    return this.memberships.get(id);
  }

  async findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMembership | undefined> {
    for (const membership of this.memberships.values()) {
      if (membership.organizationId === organizationId && membership.userId === userId) {
        return membership;
      }
    }
    return undefined;
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
    return (await this.listByOrganization(organizationId)).filter((membership) =>
      membership.isOwner(),
    ).length;
  }

  async save(membership: OrganizationMembership): Promise<void> {
    this.memberships.set(membership.id, membership);
  }

  async remove(membership: OrganizationMembership): Promise<void> {
    this.memberships.delete(membership.id);
  }
}

/** Records published events for assertions. */
export class RecordingEventPublisher implements EventPublisher {
  readonly published: readonly EventEnvelope[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    (this.published as EventEnvelope[]).push(...events);
  }

  /** The event types published so far. */
  get types(): readonly string[] {
    return this.published.map((event) => event.type);
  }
}
