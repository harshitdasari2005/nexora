/**
 * @nexora/domain-workspaces — domain policies.
 *
 * The Workspaces bounded context business rules (DOMAIN_MODEL.md §1, §13;
 * PSD.md §4 WS-*), extracted so the platform can reuse them and so aggregate
 * invariants stay in one authoritative place. Policies are pure: they have no
 * I/O and throw typed domain errors on violation.
 */

import {
  InvalidWorkspaceValueError,
  LastOwnerRemovalError,
  SlugAlreadyExistsError,
  WorkspaceArchivedError,
  WorkspaceNotActiveError,
  WorkspaceStateTransitionError,
} from '../errors/index.js';
import { MEMBERSHIP_ROLES, type MembershipRole } from '../value-objects/membership-role.js';
import type { WorkspaceStatusValue } from '../value-objects/workspace-status.js';
import { type WorkspaceStatus } from '../value-objects/workspace-status.js';

/**
 * The workspace lifecycle transition table (PSD.md WS-R5: Provisioned →
 * Active → Archived; `suspended` mirrors the tenancy model). The single
 * authoritative definition — the Workspace aggregate and all policies consult
 * it. `archived` is terminal in v1 (immutable).
 */
export const WORKSPACE_TRANSITIONS: Readonly<
  Record<WorkspaceStatusValue, readonly WorkspaceStatusValue[]>
> = {
  provisioning: ['active'],
  active: ['suspended', 'archived'],
  suspended: ['active', 'archived'],
  archived: [],
};

/**
 * Workspace lifecycle rules: allowed status transitions and execution
 * eligibility (PSD.md WS-R5).
 */
export class WorkspaceLifecyclePolicy {
  /** The statuses reachable from the given status. */
  allowedTargets(current: WorkspaceStatus): readonly WorkspaceStatusValue[] {
    return WORKSPACE_TRANSITIONS[current.value];
  }

  /**
   * Asserts the workspace may transition to the target status.
   *
   * @throws {WorkspaceStateTransitionError} when the transition is not allowed.
   */
  assertCanTransition(current: WorkspaceStatus, target: WorkspaceStatus): void {
    const allowed = this.allowedTargets(current);
    if (!allowed.includes(target.value)) {
      throw new WorkspaceStateTransitionError(
        `Cannot transition a workspace from ${current.value} to ${target.value}`,
        { from: current.value, to: target.value },
      );
    }
  }

  /**
   * Asserts the workspace may execute workflows (must be `active`; a
   * suspended workspace cannot execute workflows — core invariant).
   *
   * @throws {WorkspaceNotActiveError} when the workspace is not active.
   */
  assertCanExecuteWorkflows(status: WorkspaceStatus): void {
    if (!status.isActive()) {
      throw new WorkspaceNotActiveError({ status: status.value });
    }
  }
}

/**
 * Workspace archival rules (PSD.md WS-R5). Archival is allowed from `active`
 * and `suspended`; an archived workspace is terminal in v1 and immutable —
 * every mutation (settings, branding, bindings, memberships, installations)
 * is rejected.
 */
export class WorkspaceArchivalPolicy {
  /**
   * Asserts the workspace may be archived.
   *
   * @throws {WorkspaceStateTransitionError} when archival is not allowed.
   */
  assertCanArchive(status: WorkspaceStatus): void {
    if (status.value !== 'active' && status.value !== 'suspended') {
      throw new WorkspaceStateTransitionError(
        `Cannot archive a workspace in status ${status.value}`,
        { status: status.value },
      );
    }
  }

  /**
   * Asserts the workspace is not archived (mutations allowed).
   *
   * @throws {WorkspaceArchivedError} when the workspace is archived.
   */
  assertCanMutate(status: WorkspaceStatus): void {
    if (status.value === 'archived') {
      throw new WorkspaceArchivedError({ status: status.value });
    }
  }
}

/**
 * Workspace membership invariants (PSD.md WS-R2, WS-R6, §10 roles): role
 * validity, status gating for membership changes, and last-owner protection.
 */
export class WorkspaceMembershipPolicy {
  /**
   * Asserts a membership role is valid.
   *
   * @throws {InvalidWorkspaceValueError} when the role is unknown.
   */
  assertValidRole(role: MembershipRole): void {
    if (!MEMBERSHIP_ROLES.includes(role)) {
      throw new InvalidWorkspaceValueError('Invalid membership role', [
        { path: 'role', message: `Must be one of: ${MEMBERSHIP_ROLES.join(', ')}` },
      ]);
    }
  }

  /**
   * Asserts a new member may be added: the workspace must be `active`
   * (suspended and provisioning workspaces are frozen; archived workspaces
   * are immutable).
   *
   * @throws {WorkspaceArchivedError}  when the workspace is archived.
   * @throws {WorkspaceNotActiveError} when the workspace is not active.
   */
  assertCanAddMember(status: WorkspaceStatus): void {
    if (status.value === 'archived') {
      throw new WorkspaceArchivedError({ status: status.value });
    }
    if (!status.isActive()) {
      throw new WorkspaceNotActiveError({ status: status.value });
    }
  }

  /**
   * Asserts a member may be removed: allowed while the workspace is not
   * archived.
   *
   * @throws {WorkspaceArchivedError} when the workspace is archived.
   */
  assertCanRemoveMember(status: WorkspaceStatus): void {
    if (status.value === 'archived') {
      throw new WorkspaceArchivedError({ status: status.value });
    }
  }

  /**
   * Asserts the last owner of a workspace is not removed or demoted: a
   * workspace must always retain at least one `owner`.
   *
   * @param ownerCount - current number of owners.
   * @throws {LastOwnerRemovalError} when `ownerCount` is 1.
   */
  assertCanRemoveOwner(ownerCount: number): void {
    if (ownerCount <= 1) {
      throw new LastOwnerRemovalError({ ownerCount });
    }
  }
}

/**
 * Workspace installation invariants (PSD.md §4.2 Apps): a plugin may only be
 * installed in an active workspace; removal is allowed while the workspace is
 * not archived.
 */
export class WorkspaceInstallationPolicy {
  /**
   * Asserts a plugin may be installed in the workspace.
   *
   * @throws {WorkspaceArchivedError}  when the workspace is archived.
   * @throws {WorkspaceNotActiveError} when the workspace is not active.
   */
  assertCanInstall(status: WorkspaceStatus): void {
    if (status.value === 'archived') {
      throw new WorkspaceArchivedError({ status: status.value });
    }
    if (!status.isActive()) {
      throw new WorkspaceNotActiveError({ status: status.value });
    }
  }

  /**
   * Asserts a plugin may be removed from the workspace (not archived).
   *
   * @throws {WorkspaceArchivedError} when the workspace is archived.
   */
  assertCanRemoveInstallation(status: WorkspaceStatus): void {
    if (status.value === 'archived') {
      throw new WorkspaceArchivedError({ status: status.value });
    }
  }
}

/**
 * Agent/knowledge/workflow binding invariants (PSD.md §4.2): binding changes
 * are allowed while the workspace is not archived. Duplicate attach / missing
 * detach are collection invariants enforced by the Workspace aggregate
 * itself.
 */
export class WorkspaceBindingPolicy {
  /**
   * Asserts bindings may be changed (attached/detached).
   *
   * @throws {WorkspaceArchivedError} when the workspace is archived.
   */
  assertCanChangeBindings(status: WorkspaceStatus): void {
    if (status.value === 'archived') {
      throw new WorkspaceArchivedError({ status: status.value });
    }
  }
}

/**
 * Slug uniqueness policy — the domain contract that workspace slugs are
 * unique **within an organization** (PSD.md §4). The rule is enforced in the
 * domain via the repository port (`existsBySlug`) and in the infrastructure
 * layer via a scoped unique index; this policy is the single statement of the
 * contract.
 */
export class SlugUniquenessPolicy {
  /**
   * Asserts a slug is available within the organization.
   *
   * @param exists - whether the repository already holds the slug for the org.
   * @throws {SlugAlreadyExistsError} when the slug is taken.
   */
  assertSlugAvailable(exists: boolean): void {
    if (exists) {
      throw new SlugAlreadyExistsError();
    }
  }
}
