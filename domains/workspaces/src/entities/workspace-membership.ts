/**
 * @nexora/domain-workspaces — WorkspaceMembership aggregate root.
 *
 * A user's membership in a {@link Workspace} (PSD.md WS-R2: a user may belong
 * to multiple Workspaces, each membership carrying its own roles). A separate
 * aggregate from Workspace with its own repository: membership carries its
 * own identity, role, and lifecycle, and the last-owner invariant is enforced
 * across memberships by the `WorkspaceMembershipService`. Removal is a hard
 * delete owned by the service (the service emits `workspace.member_removed` —
 * see docs/AGGREGATES.md).
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { UserId } from '@nexora/contracts/common';

import type { WorkspaceEventContext } from '../events/index.js';
import { memberAddedEvent } from '../events/index.js';
import { InvalidWorkspaceValueError } from '../errors/index.js';
import type { WorkspaceId } from '../value-objects/workspace-id.js';
import { MEMBERSHIP_ROLES, type MembershipRole } from '../value-objects/membership-role.js';

/** Input for adding a member to a workspace. */
export interface AddMemberInput {
  /** The workspace the user joins. */
  workspaceId: WorkspaceId;
  /** The joining user. */
  userId: UserId;
  /** The role granted at join time. */
  role: MembershipRole;
}

/**
 * A persistence snapshot of the {@link WorkspaceMembership} aggregate
 * (PERSISTENCE.md §4 aggregate ownership). Plain data produced by
 * {@link WorkspaceMembership.snapshot} and consumed by
 * {@link WorkspaceMembership.hydrate} — no behavior.
 */
export interface WorkspaceMembershipSnapshot {
  /** The membership id. */
  id: string;
  /** The workspace the user belongs to. */
  workspaceId: WorkspaceId;
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
 * The {@link WorkspaceMembership} aggregate root. Use
 * {@link WorkspaceMembership.create} to construct; mutate only through
 * aggregate methods.
 */
export class WorkspaceMembership {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: string;
  readonly #workspaceId: WorkspaceId;
  readonly #userId: UserId;
  #role: MembershipRole;
  readonly #joinedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: AddMemberInput, joinedAt: string) {
    this.#id = prefixedId('mbr') as string;
    this.#workspaceId = input.workspaceId;
    this.#userId = input.userId;
    this.#role = input.role;
    this.#joinedAt = joinedAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link WorkspaceMembership} and records a
   * {@link memberAddedEvent}.
   *
   * @param input   - membership data.
   * @param context - event context.
   * @param now     - ISO-8601 UTC join time (defaults to now).
   * @throws {InvalidWorkspaceValueError} when the role is not valid.
   */
  static create(
    input: AddMemberInput,
    context: WorkspaceEventContext,
    now = nowIso(),
  ): WorkspaceMembership {
    if (!MEMBERSHIP_ROLES.includes(input.role)) {
      throw new InvalidWorkspaceValueError('Invalid membership role', [
        { path: 'role', message: `Must be one of: ${MEMBERSHIP_ROLES.join(', ')}` },
      ]);
    }
    const membership = new WorkspaceMembership(input, now);
    membership.#events.push(
      memberAddedEvent(context, {
        workspaceId: membership.#workspaceId,
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

  /** The workspace the user belongs to. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
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
   * catalog has `member_added`/`member_removed` only).
   *
   * @param newRole - the new role.
   * @throws {InvalidWorkspaceValueError} when the role is not valid.
   * @returns true when the role changed.
   */
  changeRole(newRole: MembershipRole): boolean {
    if (!MEMBERSHIP_ROLES.includes(newRole)) {
      throw new InvalidWorkspaceValueError('Invalid membership role', [
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
  static snapshot(membership: WorkspaceMembership): WorkspaceMembershipSnapshot {
    return {
      id: membership.id,
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      role: membership.role,
      joinedAt: membership.joinedAt,
      version: membership.version,
    };
  }

  /**
   * Reconstructs a {@link WorkspaceMembership} from a persistence snapshot
   * without emitting domain events (DDD reconstitution factory).
   */
  static hydrate(snapshot: WorkspaceMembershipSnapshot): WorkspaceMembership {
    if (!MEMBERSHIP_ROLES.includes(snapshot.role)) {
      throw new InvalidWorkspaceValueError('Invalid membership role', [
        { path: 'role', message: `Must be one of: ${MEMBERSHIP_ROLES.join(', ')}` },
      ]);
    }
    const membership = new WorkspaceMembership(
      {
        workspaceId: snapshot.workspaceId,
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
