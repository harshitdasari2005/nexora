/**
 * In-memory repository fakes and test builders for the workspaces domain
 * tests. These implement the domain repository interfaces without
 * persistence; they are test-only and never shipped.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';

import type { Workspace } from '../src/entities/workspace.js';
import type { WorkspaceMembership } from '../src/entities/workspace-membership.js';
import type { WorkspaceInstallation } from '../src/entities/workspace-installation.js';
import type {
  WorkspaceInstallationRepository,
  WorkspaceMembershipRepository,
  WorkspaceRepository,
} from '../src/repositories/index.js';
import type { WorkspaceId } from '../src/value-objects/workspace-id.js';
import type { WorkspaceSlug } from '../src/value-objects/workspace-slug.js';
import type { WorkspaceEventContext } from '../src/events/index.js';

/** An in-memory {@link WorkspaceRepository}. */
export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  readonly workspaces = new Map<string, Workspace>();

  async findById(id: WorkspaceId): Promise<Workspace | undefined> {
    return this.workspaces.get(id);
  }

  async findBySlug(organizationId: TenantId, slug: WorkspaceSlug): Promise<Workspace | undefined> {
    for (const workspace of this.workspaces.values()) {
      if (workspace.organizationId === organizationId && workspace.slug.equals(slug)) {
        return workspace;
      }
    }
    return undefined;
  }

  async existsBySlug(organizationId: TenantId, slug: WorkspaceSlug): Promise<boolean> {
    return (await this.findBySlug(organizationId, slug)) !== undefined;
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly Workspace[]> {
    return [...this.workspaces.values()].filter(
      (workspace) => workspace.organizationId === organizationId,
    );
  }

  async listByIds(ids: readonly WorkspaceId[]): Promise<readonly Workspace[]> {
    return [...this.workspaces.values()].filter((workspace) =>
      (ids as readonly string[]).includes(workspace.id),
    );
  }

  async save(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }
}

/** An in-memory {@link WorkspaceMembershipRepository}. */
export class InMemoryWorkspaceMembershipRepository implements WorkspaceMembershipRepository {
  readonly memberships = new Map<string, WorkspaceMembership>();
  readonly byWorkspaceAndUser = new Map<string, WorkspaceMembership>();

  async findById(id: string): Promise<WorkspaceMembership | undefined> {
    return this.memberships.get(id);
  }

  async findByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<WorkspaceMembership | undefined> {
    return this.byWorkspaceAndUser.get(`${workspaceId}:${userId}`);
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly WorkspaceMembership[]> {
    return [...this.memberships.values()].filter(
      (membership) => membership.workspaceId === workspaceId,
    );
  }

  async listByUser(userId: UserId): Promise<readonly WorkspaceMembership[]> {
    return [...this.memberships.values()].filter((membership) => membership.userId === userId);
  }

  async countOwners(workspaceId: WorkspaceId): Promise<number> {
    const members = await this.listByWorkspace(workspaceId);
    return members.filter((membership) => membership.isOwner()).length;
  }

  async save(membership: WorkspaceMembership): Promise<void> {
    this.memberships.set(membership.id, membership);
    this.byWorkspaceAndUser.set(`${membership.workspaceId}:${membership.userId}`, membership);
  }

  async remove(membership: WorkspaceMembership): Promise<void> {
    this.memberships.delete(membership.id);
    this.byWorkspaceAndUser.delete(`${membership.workspaceId}:${membership.userId}`);
  }
}

/** An in-memory {@link WorkspaceInstallationRepository}. */
export class InMemoryWorkspaceInstallationRepository implements WorkspaceInstallationRepository {
  readonly installations = new Map<string, WorkspaceInstallation>();
  readonly byWorkspaceAndPlugin = new Map<string, WorkspaceInstallation>();

  async findById(id: string): Promise<WorkspaceInstallation | undefined> {
    return this.installations.get(id);
  }

  async findByWorkspaceAndPlugin(
    workspaceId: WorkspaceId,
    pluginId: string,
  ): Promise<WorkspaceInstallation | undefined> {
    return this.byWorkspaceAndPlugin.get(`${workspaceId}:${pluginId}`);
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly WorkspaceInstallation[]> {
    return [...this.installations.values()].filter(
      (installation) => installation.workspaceId === workspaceId,
    );
  }

  async save(installation: WorkspaceInstallation): Promise<void> {
    this.installations.set(installation.id, installation);
    this.byWorkspaceAndPlugin.set(
      `${installation.workspaceId}:${installation.pluginId}`,
      installation,
    );
  }

  async remove(installation: WorkspaceInstallation): Promise<void> {
    this.installations.delete(installation.id);
    this.byWorkspaceAndPlugin.delete(`${installation.workspaceId}:${installation.pluginId}`);
  }
}

/** A reusable event context for tests. */
export function testContext(overrides: Partial<WorkspaceEventContext> = {}): WorkspaceEventContext {
  return {
    actor: { kind: 'user', id: 'usr_system' },
    correlationId: 'corr_test',
    organizationId: 'tenant_1' as TenantId,
    ...overrides,
  };
}
