/**
 * @nexora/domain-workspaces — repository interfaces & ports.
 *
 * The persistence contracts the Workspaces domain depends on (DDD.md §6, §7;
 * PERSISTENCE.md §4 aggregate ownership). Interfaces only — the
 * infrastructure layer provides implementations. Each aggregate is the
 * transaction boundary: saving a {@link Workspace} persists the whole
 * aggregate (settings, branding, preferences, features, bindings) atomically.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';

import type { Workspace } from '../entities/workspace.js';
import type { WorkspaceMembership } from '../entities/workspace-membership.js';
import type { WorkspaceInstallation } from '../entities/workspace-installation.js';
import type { WorkspaceId } from '../value-objects/workspace-id.js';
import type { WorkspaceSlug } from '../value-objects/workspace-slug.js';

/**
 * Persistence contract for the {@link Workspace} aggregate. The aggregate is
 * the transaction boundary: save persists the whole aggregate (settings,
 * branding, preferences, features, bindings) atomically.
 */
export interface WorkspaceRepository {
  /** Finds a workspace by id, or `undefined`. */
  findById(id: WorkspaceId): Promise<Workspace | undefined>;
  /** Finds a workspace by slug within an organization, or `undefined`. */
  findBySlug(organizationId: TenantId, slug: WorkspaceSlug): Promise<Workspace | undefined>;
  /**
   * Whether a workspace with the slug exists in the organization. Slug
   * uniqueness is scoped per organization: enforced here through the port and
   * in the infrastructure layer via a scoped unique index
   * (SlugUniquenessPolicy).
   */
  existsBySlug(organizationId: TenantId, slug: WorkspaceSlug): Promise<boolean>;
  /** Lists the workspaces of an organization. */
  listByOrganization(organizationId: TenantId): Promise<readonly Workspace[]>;
  /**
   * Batched workspace lookup by ids (single query — avoids N+1 on
   * membership-driven read paths such as `listMyWorkspaces`).
   */
  listByIds(ids: readonly WorkspaceId[]): Promise<readonly Workspace[]>;
  /** Persists the workspace aggregate (insert or update). */
  save(workspace: Workspace): Promise<void>;
}

/**
 * Persistence contract for the {@link WorkspaceMembership} aggregate.
 */
export interface WorkspaceMembershipRepository {
  /** Finds a membership by id, or `undefined`. */
  findById(id: string): Promise<WorkspaceMembership | undefined>;
  /** Finds the membership of a user in a workspace, or `undefined`. */
  findByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<WorkspaceMembership | undefined>;
  /** Lists the memberships of a workspace. */
  listByWorkspace(workspaceId: WorkspaceId): Promise<readonly WorkspaceMembership[]>;
  /**
   * Lists the memberships of a user across workspaces — the access-control
   * read model for authorization decisions (who may act where). Mirrors the
   * Organizations domain `listByUser` port.
   */
  listByUser(userId: UserId): Promise<readonly WorkspaceMembership[]>;
  /** Counts the `owner` memberships of a workspace. */
  countOwners(workspaceId: WorkspaceId): Promise<number>;
  /** Persists the membership aggregate (insert or update). */
  save(membership: WorkspaceMembership): Promise<void>;
  /** Removes the membership (hard delete). */
  remove(membership: WorkspaceMembership): Promise<void>;
}

/**
 * Persistence contract for the {@link WorkspaceInstallation} aggregate.
 */
export interface WorkspaceInstallationRepository {
  /** Finds an installation by id, or `undefined`. */
  findById(id: string): Promise<WorkspaceInstallation | undefined>;
  /** Finds the installation of a plugin in a workspace, or `undefined`. */
  findByWorkspaceAndPlugin(
    workspaceId: WorkspaceId,
    pluginId: string,
  ): Promise<WorkspaceInstallation | undefined>;
  /** Lists the installations of a workspace. */
  listByWorkspace(workspaceId: WorkspaceId): Promise<readonly WorkspaceInstallation[]>;
  /** Persists the installation aggregate (insert or update). */
  save(installation: WorkspaceInstallation): Promise<void>;
  /** Removes the installation (hard delete). */
  remove(installation: WorkspaceInstallation): Promise<void>;
}
