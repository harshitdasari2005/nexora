/**
 * @nexora/domain-workspaces — WorkspacePolicyService.
 *
 * The policy evaluation façade for the Workspaces context. It exposes the
 * business policies (lifecycle, archival, membership, installation, binding)
 * as single-purpose checks against a {@link Workspace} so the application
 * layer and other services have one entry point for workspace policy
 * questions (e.g. "can this workspace execute workflows?", "is it
 * immutable?"). Pure: no I/O; it delegates to the policy classes.
 */

import type { Workspace } from '../entities/workspace.js';
import {
  SlugUniquenessPolicy,
  WorkspaceArchivalPolicy,
  WorkspaceBindingPolicy,
  WorkspaceInstallationPolicy,
  WorkspaceLifecyclePolicy,
  WorkspaceMembershipPolicy,
} from '../policies/index.js';
import type { MembershipRole } from '../value-objects/membership-role.js';
import type { WorkspaceStatus } from '../value-objects/workspace-status.js';

/** Dependencies of the {@link WorkspacePolicyService}. */
export interface WorkspacePolicyServiceDependencies {
  /** Lifecycle policy. */
  lifecycle?: WorkspaceLifecyclePolicy;
  /** Archival policy. */
  archival?: WorkspaceArchivalPolicy;
  /** Membership policy. */
  membership?: WorkspaceMembershipPolicy;
  /** Installation policy. */
  installation?: WorkspaceInstallationPolicy;
  /** Binding policy. */
  binding?: WorkspaceBindingPolicy;
  /** Slug uniqueness policy. */
  slugPolicy?: SlugUniquenessPolicy;
}

/**
 * Policy evaluation service. Throwing variants raise typed domain errors;
 * boolean variants return `false` for callers that must not fail.
 */
export class WorkspacePolicyService {
  readonly #lifecycle: WorkspaceLifecyclePolicy;
  readonly #archival: WorkspaceArchivalPolicy;
  readonly #membership: WorkspaceMembershipPolicy;
  readonly #installation: WorkspaceInstallationPolicy;
  readonly #binding: WorkspaceBindingPolicy;
  readonly #slugPolicy: SlugUniquenessPolicy;

  constructor(dependencies: WorkspacePolicyServiceDependencies = {}) {
    this.#lifecycle = dependencies.lifecycle ?? new WorkspaceLifecyclePolicy();
    this.#archival = dependencies.archival ?? new WorkspaceArchivalPolicy();
    this.#membership = dependencies.membership ?? new WorkspaceMembershipPolicy();
    this.#installation = dependencies.installation ?? new WorkspaceInstallationPolicy();
    this.#binding = dependencies.binding ?? new WorkspaceBindingPolicy();
    this.#slugPolicy = dependencies.slugPolicy ?? new SlugUniquenessPolicy();
  }

  /** Whether the workspace may execute workflows (must be active). */
  canExecuteWorkflows(workspace: Workspace): boolean {
    try {
      this.#lifecycle.assertCanExecuteWorkflows(workspace.status);
      return true;
    } catch {
      return false;
    }
  }

  /** Asserts the workspace may execute workflows. */
  assertCanExecuteWorkflows(workspace: Workspace): void {
    this.#lifecycle.assertCanExecuteWorkflows(workspace.status);
  }

  /** Whether the workspace is archived (immutable). */
  isArchived(workspace: Workspace): boolean {
    return workspace.status.value === 'archived';
  }

  /** Asserts the workspace is not archived (mutations allowed). */
  assertCanMutate(workspace: Workspace): void {
    this.#archival.assertCanMutate(workspace.status);
  }

  /** Asserts the workspace may transition to the target status. */
  assertCanTransition(workspace: Workspace, target: WorkspaceStatus): void {
    this.#lifecycle.assertCanTransition(workspace.status, target);
  }

  /** Whether a new member may be added to the workspace. */
  canAddMember(workspace: Workspace): boolean {
    try {
      this.#membership.assertCanAddMember(workspace.status);
      return true;
    } catch {
      return false;
    }
  }

  /** Asserts a new member may be added. */
  assertCanAddMember(workspace: Workspace): void {
    this.#membership.assertCanAddMember(workspace.status);
  }

  /** Asserts the role is valid. */
  assertValidRole(role: MembershipRole): void {
    this.#membership.assertValidRole(role);
  }

  /** Asserts the last owner is not removed/demoted. */
  assertCanRemoveOwner(ownerCount: number): void {
    this.#membership.assertCanRemoveOwner(ownerCount);
  }

  /** Asserts a plugin may be installed. */
  assertCanInstall(workspace: Workspace): void {
    this.#installation.assertCanInstall(workspace.status);
  }

  /** Asserts bindings may be changed. */
  assertCanChangeBindings(workspace: Workspace): void {
    this.#binding.assertCanChangeBindings(workspace.status);
  }

  /** Asserts a slug is available within the organization. */
  assertSlugAvailable(exists: boolean): void {
    this.#slugPolicy.assertSlugAvailable(exists);
  }
}
