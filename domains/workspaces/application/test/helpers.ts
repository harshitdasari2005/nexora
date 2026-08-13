/**
 * Test-only fakes for the workspaces application layer: in-memory
 * repository implementations and a recording {@link EventPublisher}.
 */

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import type { TenantId, UserId } from '@nexora/contracts/common';

import type {
  WorkspaceRepository,
  WorkspaceMembershipRepository,
  WorkspaceInstallationRepository,
  Workspace,
  WorkspaceMembership,
  WorkspaceInstallation,
} from '@nexora/domain-workspaces';
import type { WorkspaceId, WorkspaceSlug } from '@nexora/domain-workspaces';

/** An in-memory {@link WorkspaceRepository}. */
export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  readonly workspaces = new Map<string, Workspace>();

  async findById(id: WorkspaceId): Promise<Workspace | undefined> {
    return this.workspaces.get(id);
  }

  async findBySlug(organizationId: TenantId, slug: WorkspaceSlug): Promise<Workspace | undefined> {
    for (const workspace of this.workspaces.values()) {
      if (workspace.organizationId === organizationId && workspace.slug.value === slug.value) {
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

  async findById(id: string): Promise<WorkspaceMembership | undefined> {
    return this.memberships.get(id);
  }

  async findByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<WorkspaceMembership | undefined> {
    for (const membership of this.memberships.values()) {
      if (membership.workspaceId === workspaceId && membership.userId === userId) {
        return membership;
      }
    }
    return undefined;
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
    return (await this.listByWorkspace(workspaceId)).filter((membership) => membership.isOwner())
      .length;
  }

  async save(membership: WorkspaceMembership): Promise<void> {
    this.memberships.set(membership.id, membership);
  }

  async remove(membership: WorkspaceMembership): Promise<void> {
    this.memberships.delete(membership.id);
  }
}

/** An in-memory {@link WorkspaceInstallationRepository}. */
export class InMemoryWorkspaceInstallationRepository implements WorkspaceInstallationRepository {
  readonly installations = new Map<string, WorkspaceInstallation>();

  async findById(id: string): Promise<WorkspaceInstallation | undefined> {
    return this.installations.get(id);
  }

  async findByWorkspaceAndPlugin(
    workspaceId: WorkspaceId,
    pluginId: string,
  ): Promise<WorkspaceInstallation | undefined> {
    return [...this.installations.values()].find(
      (installation) =>
        installation.workspaceId === workspaceId && installation.pluginId === pluginId,
    );
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly WorkspaceInstallation[]> {
    return [...this.installations.values()].filter(
      (installation) => installation.workspaceId === workspaceId,
    );
  }

  async save(installation: WorkspaceInstallation): Promise<void> {
    this.installations.set(installation.id, installation);
  }

  async remove(installation: WorkspaceInstallation): Promise<void> {
    this.installations.delete(installation.id);
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
