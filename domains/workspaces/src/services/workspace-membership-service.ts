/**
 * @nexora/domain-workspaces — WorkspaceMembershipService.
 *
 * Orchestrates the {@link WorkspaceMembership} aggregate (PSD.md WS-R2:
 * membership carries its own roles per workspace). Cross-aggregate invariants
 * live here — workspace-status gating and the last-owner rule require the
 * Workspace aggregate plus membership counts (docs/AGGREGATES.md).
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';
import type { UserId } from '@nexora/contracts/common';

import type { WorkspaceEventContext } from '../events/index.js';
import { memberRemovedEvent } from '../events/index.js';
import { WorkspaceMembership } from '../entities/workspace-membership.js';
import type { MembershipRole } from '../value-objects/membership-role.js';
import type {
  InvalidWorkspaceValueError,
  LastOwnerRemovalError,
  WorkspaceArchivedError,
  WorkspaceNotActiveError,
} from '../errors/index.js';
import {
  MemberAlreadyExistsError,
  MemberNotFoundError,
  toWorkspaceError,
  WorkspaceNotFoundError,
} from '../errors/index.js';
import type { WorkspaceMembershipRepository, WorkspaceRepository } from '../repositories/index.js';
import { WorkspaceMembershipPolicy } from '../policies/index.js';
import type { WorkspaceId } from '../value-objects/workspace-id.js';

/** The outcome of a membership command: the aggregate plus emitted events. */
export interface MembershipCommandResult {
  /** The mutated membership aggregate. */
  membership: WorkspaceMembership;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link WorkspaceMembershipService}. */
export interface WorkspaceMembershipServiceDependencies {
  /** Membership persistence. */
  memberships: WorkspaceMembershipRepository;
  /** Workspace persistence (status gating, last-owner count). */
  workspaces: WorkspaceRepository;
  /** Membership policy (role validity, gating, last-owner rule). */
  membershipPolicy?: WorkspaceMembershipPolicy;
}

/**
 * The membership use-case service. All methods return a `Result` so expected
 * failures are explicit values, not exceptions.
 */
export class WorkspaceMembershipService {
  readonly #memberships: WorkspaceMembershipRepository;
  readonly #workspaces: WorkspaceRepository;
  readonly #policy: WorkspaceMembershipPolicy;

  constructor(dependencies: WorkspaceMembershipServiceDependencies) {
    this.#memberships = dependencies.memberships;
    this.#workspaces = dependencies.workspaces;
    this.#policy = dependencies.membershipPolicy ?? new WorkspaceMembershipPolicy();
  }

  /**
   * Adds a user to a workspace: the workspace must be `active`, the user must
   * not already be a member, and the role must be valid.
   */
  async addMember(
    workspaceId: WorkspaceId,
    userId: UserId,
    role: MembershipRole,
    context: WorkspaceEventContext,
  ): Promise<
    Result<
      MembershipCommandResult,
      | WorkspaceNotFoundError
      | WorkspaceNotActiveError
      | WorkspaceArchivedError
      | MemberAlreadyExistsError
      | InvalidWorkspaceValueError
    >
  > {
    try {
      this.#policy.assertValidRole(role);
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#policy.assertCanAddMember(workspace.status);

      const existing = await this.#memberships.findByWorkspaceAndUser(workspaceId, userId);
      if (existing !== undefined) {
        return err(new MemberAlreadyExistsError({ workspaceId, userId }));
      }

      const membership = WorkspaceMembership.create({ workspaceId, userId, role }, context);
      await this.#memberships.save(membership);
      return ok({ membership, events: membership.pullDomainEvents() });
    } catch (error) {
      return err(
        toWorkspaceError(error) as
          | WorkspaceNotFoundError
          | WorkspaceNotActiveError
          | WorkspaceArchivedError
          | MemberAlreadyExistsError
          | InvalidWorkspaceValueError,
      );
    }
  }

  /**
   * Removes a user from a workspace: the membership must exist, the workspace
   * must not be archived, and the last owner cannot be removed. Emits
   * `workspace.member_removed` (removal is a hard delete — docs/AGGREGATES.md).
   */
  async removeMember(
    workspaceId: WorkspaceId,
    userId: UserId,
    context: WorkspaceEventContext,
  ): Promise<
    Result<
      MembershipCommandResult,
      WorkspaceNotFoundError | WorkspaceArchivedError | MemberNotFoundError | LastOwnerRemovalError
    >
  > {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#policy.assertCanRemoveMember(workspace.status);

      const membership = await this.#memberships.findByWorkspaceAndUser(workspaceId, userId);
      if (membership === undefined) {
        return err(new MemberNotFoundError({ workspaceId, userId }));
      }

      if (membership.isOwner()) {
        this.#policy.assertCanRemoveOwner(await this.#memberships.countOwners(workspaceId));
      }

      const events: EventEnvelope[] = [
        memberRemovedEvent(context, {
          workspaceId,
          membershipId: membership.id,
          userId,
          role: membership.role,
        }),
      ];
      await this.#memberships.remove(membership);
      return ok({ membership, events });
    } catch (error) {
      return err(
        toWorkspaceError(error) as
          | WorkspaceNotFoundError
          | WorkspaceArchivedError
          | MemberNotFoundError
          | LastOwnerRemovalError,
      );
    }
  }

  /**
   * Changes a member's role: the membership must exist, the workspace must
   * not be archived, the role must be valid, and the last owner cannot be
   * demoted. Role changes emit no domain event in v1 (documented); `context`
   * is reserved for the future `member_role_changed` event.
   */
  async changeRole(
    workspaceId: WorkspaceId,
    userId: UserId,
    newRole: MembershipRole,
    _context: WorkspaceEventContext,
  ): Promise<
    Result<
      MembershipCommandResult,
      | WorkspaceNotFoundError
      | WorkspaceArchivedError
      | MemberNotFoundError
      | LastOwnerRemovalError
      | InvalidWorkspaceValueError
    >
  > {
    try {
      this.#policy.assertValidRole(newRole);
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#policy.assertCanRemoveMember(workspace.status);

      const membership = await this.#memberships.findByWorkspaceAndUser(workspaceId, userId);
      if (membership === undefined) {
        return err(new MemberNotFoundError({ workspaceId, userId }));
      }

      if (membership.isOwner() && newRole !== 'owner') {
        this.#policy.assertCanRemoveOwner(await this.#memberships.countOwners(workspaceId));
      }

      membership.changeRole(newRole);
      await this.#memberships.save(membership);
      return ok({ membership, events: membership.pullDomainEvents() });
    } catch (error) {
      return err(
        toWorkspaceError(error) as
          | WorkspaceNotFoundError
          | WorkspaceArchivedError
          | MemberNotFoundError
          | LastOwnerRemovalError
          | InvalidWorkspaceValueError,
      );
    }
  }

  /** Lists the memberships of a workspace. */
  async listByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly WorkspaceMembership[], WorkspaceNotFoundError>> {
    const workspace = await this.#workspaces.findById(workspaceId);
    if (workspace === undefined) {
      return err(new WorkspaceNotFoundError({ workspaceId }));
    }
    return ok(await this.#memberships.listByWorkspace(workspaceId));
  }

  /**
   * Lists the memberships of a user across workspaces (the access-control
   * read model: which workspaces the user may act in). Pure read — no
   * workspace resolution required.
   */
  async listByUser(userId: UserId): Promise<Result<readonly WorkspaceMembership[], never>> {
    return ok(await this.#memberships.listByUser(userId));
  }

  /** Loads a workspace or throws {@link WorkspaceNotFoundError}. */
  async #requireWorkspace(workspaceId: WorkspaceId) {
    const workspace = await this.#workspaces.findById(workspaceId);
    if (workspace === undefined) {
      throw new WorkspaceNotFoundError({ workspaceId });
    }
    return workspace;
  }
}
