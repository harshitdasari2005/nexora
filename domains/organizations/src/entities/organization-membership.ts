/**
 * @nexora/domain-organizations — OrganizationMembership aggregate root.
 *
 * A user's membership in an {@link Organization} (PSD.md WS-R2 membership;
 * DOMAIN_MODEL.md §1 Tenancy). A separate aggregate from Organization with its
 * own repository: membership carries its own identity, role, and lifecycle,
 * and the last-owner invariant is enforced across memberships by the
 * `MembershipDomainService`. Removal is a hard delete owned by the service
 * (the aggregate records no removal event; the service emits
 * `organization.member_removed` — see docs/AGGREGATES.md).
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { UserId } from '@nexora/contracts/common';

import type { OrganizationEventContext } from '../events/index.js';
import { memberAddedEvent } from '../events/index.js';
import { InvalidOrganizationValueError } from '../errors/index.js';
import type { OrganizationId } from '../value-objects/organization-id.js';
import { MEMBERSHIP_ROLES, type MembershipRole } from '../value-objects/membership-role.js';

// Re-exported for callers that import the role vocabulary from the entity
// module; the canonical home is value-objects/membership-role.ts.
export { MEMBERSHIP_ROLES, type MembershipRole } from '../value-objects/membership-role.js';

/** Input for adding a member to an organization. */
export interface AddMemberInput {
  /** The organization the user joins. */
  organizationId: OrganizationId;
  /** The joining user. */
  userId: UserId;
  /** The role granted at join time. */
  role: MembershipRole;
}

/**
 * A persistence snapshot of the {@link OrganizationMembership} aggregate
 * (PERSISTENCE.md §4 aggregate ownership). Plain data produced by
 * {@link OrganizationMembership.snapshot} and consumed by
 * {@link OrganizationMembership.hydrate} — no behavior.
 */
export interface OrganizationMembershipSnapshot {
  /** The membership id. */
  id: string;
  /** The organization the user belongs to. */
  organizationId: OrganizationId;
  /** The member user. */
  userId: UserId;
  /** The current role. */
  role: MembershipRole;
  /** ISO-8601 UTC join time. */
  joinedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link OrganizationMembership} aggregate root. Use
 * {@link OrganizationMembership.create} to construct; mutate only through
 * aggregate methods.
 */
export class OrganizationMembership {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: string;
  readonly #organizationId: OrganizationId;
  readonly #userId: UserId;
  #role: MembershipRole;
  readonly #joinedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: AddMemberInput, joinedAt: string) {
    this.#id = prefixedId('mbr') as string;
    this.#organizationId = input.organizationId;
    this.#userId = input.userId;
    this.#role = input.role;
    this.#joinedAt = joinedAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link OrganizationMembership} and records a
   * {@link memberAddedEvent}.
   *
   * @param input   - membership data.
   * @param context - event context.
   * @param now     - ISO-8601 UTC join time (defaults to now).
   * @throws {InvalidOrganizationValueError} when the role is not valid.
   */
  static create(
    input: AddMemberInput,
    context: OrganizationEventContext,
    now = nowIso(),
  ): OrganizationMembership {
    if (!MEMBERSHIP_ROLES.includes(input.role)) {
      throw new InvalidOrganizationValueError('Invalid membership role', [
        { path: 'role', message: `Must be one of: ${MEMBERSHIP_ROLES.join(', ')}` },
      ]);
    }
    const membership = new OrganizationMembership(input, now);
    membership.#events.push(
      memberAddedEvent(context, {
        organizationId: membership.#organizationId,
        membershipId: membership.#id,
        userId: membership.#userId,
        role: membership.#role,
      }),
    );
    return membership;
  }

  /** The membership id. */
  get id(): string {
    return this.#id;
  }

  /** The organization the user belongs to. */
  get organizationId(): OrganizationId {
    return this.#organizationId;
  }

  /** The member user. */
  get userId(): UserId {
    return this.#userId;
  }

  /** The current role. */
  get role(): MembershipRole {
    return this.#role;
  }

  /** ISO-8601 UTC join time. */
  get joinedAt(): string {
    return this.#joinedAt;
  }

  /** Monotonic version for optimistic concurrency. */
  get version(): number {
    return this.#version;
  }

  /** Whether the member holds the `owner` role. */
  isOwner(): boolean {
    return this.#role === 'owner';
  }

  /**
   * Changes the membership role. A change to the same role is a no-op
   * (returns false). Role changes do not emit a domain event in v1 (the
   * event catalog has `member_added`/`member_removed` only; a future
   * `member_role_changed` will be added with the catalog).
   *
   * @param newRole - the new role.
   * @throws {InvalidOrganizationValueError} when the role is not valid.
   * @returns true when the role changed.
   */
  changeRole(newRole: MembershipRole): boolean {
    if (!MEMBERSHIP_ROLES.includes(newRole)) {
      throw new InvalidOrganizationValueError('Invalid membership role', [
        { path: 'role', message: `Must be one of: ${MEMBERSHIP_ROLES.join(', ')}` },
      ]);
    }
    if (newRole === this.#role) {
      return false;
    }
    this.#role = newRole;
    this.#version += 1;
    return true;
  }

  /**
   * Produces a persistence snapshot of the membership (PERSISTENCE.md §4
   * aggregate ownership).
   */
  static snapshot(membership: OrganizationMembership): OrganizationMembershipSnapshot {
    return {
      id: membership.id,
      organizationId: membership.organizationId,
      userId: membership.userId,
      role: membership.role,
      joinedAt: membership.joinedAt,
      version: membership.version,
    };
  }

  /**
   * Reconstructs an {@link OrganizationMembership} from a persistence
   * snapshot without emitting domain events (DDD reconstitution factory).
   */
  static hydrate(snapshot: OrganizationMembershipSnapshot): OrganizationMembership {
    if (!MEMBERSHIP_ROLES.includes(snapshot.role)) {
      throw new InvalidOrganizationValueError('Invalid membership role', [
        { path: 'role', message: `Must be one of: ${MEMBERSHIP_ROLES.join(', ')}` },
      ]);
    }
    const membership = new OrganizationMembership(
      {
        organizationId: snapshot.organizationId,
        userId: snapshot.userId,
        role: snapshot.role,
      },
      snapshot.joinedAt,
    );
    membership.#id = snapshot.id;
    membership.#version = snapshot.version;
    return membership;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }
}
