/**
 * @nexora/persistence — workspaces repositories.
 *
 * Drizzle implementations of the Workspaces domain repository interfaces
 * (`WorkspaceRepository`, `WorkspaceMembershipRepository`,
 * `WorkspaceInstallationRepository`). Aggregates are serialized via
 * `snapshot()` and reconstructed via `hydrate()` (PERSISTENCE.md §4).
 */

import { and, eq, inArray } from 'drizzle-orm';
import type {
  WorkspaceInstallationRepository,
  WorkspaceMembershipRepository,
  WorkspaceRepository,
} from '@nexora/domain-workspaces';
import {
  Workspace,
  WorkspaceId,
  WorkspaceInstallation,
  WorkspaceMembership,
  WorkspaceName,
  WorkspaceSlug,
  WorkspaceStatus,
  WorkspaceType,
  WorkspaceVisibility,
} from '@nexora/domain-workspaces';
import type { TenantId, UserId } from '@nexora/contracts/common';

import type { NexoraDatabase } from '../db.js';
import { workspaceInstallations, workspaceMemberships, workspaces } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

type WorkspaceRow = typeof workspaces.$inferSelect;
type MembershipRow = typeof workspaceMemberships.$inferSelect;
type InstallationRow = typeof workspaceInstallations.$inferSelect;

/** Maps a workspaces row to a {@link Workspace} snapshot. */
function rowToWorkspaceSnapshot(row: WorkspaceRow): ReturnType<typeof Workspace.snapshot> {
  const snapshot: ReturnType<typeof Workspace.snapshot> = {
    id: WorkspaceId.from(row.id),
    organizationId: row.organizationId as TenantId,
    slug: WorkspaceSlug.create(row.slug),
    name: WorkspaceName.create(row.name).value,
    type: WorkspaceType.from(row.type),
    visibility: WorkspaceVisibility.from(row.visibility).value,
    status: WorkspaceStatus.from(row.status).value,
    settings: row.settings as ReturnType<typeof Workspace.snapshot>['settings'],
    branding: row.branding as ReturnType<typeof Workspace.snapshot>['branding'],
    preferences: row.preferences as ReturnType<typeof Workspace.snapshot>['preferences'],
    features: row.features as ReturnType<typeof Workspace.snapshot>['features'],
    agentBindings: row.agentBindings as ReturnType<typeof Workspace.snapshot>['agentBindings'],
    knowledgeBindings: row.knowledgeBindings as ReturnType<
      typeof Workspace.snapshot
    >['knowledgeBindings'],
    workflowBindings: row.workflowBindings as ReturnType<
      typeof Workspace.snapshot
    >['workflowBindings'],
    searchBinding: (row.searchBinding ?? undefined) as ReturnType<
      typeof Workspace.snapshot
    >['searchBinding'],
    notificationBinding: (row.notificationBinding ?? undefined) as ReturnType<
      typeof Workspace.snapshot
    >['notificationBinding'],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
  return snapshot;
}

/** Maps a {@link Workspace} snapshot to a workspaces row. */
function workspaceSnapshotToRow(snapshot: ReturnType<typeof Workspace.snapshot>): WorkspaceRow {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    slug: snapshot.slug.value,
    name: snapshot.name,
    type: snapshot.type.value,
    visibility: snapshot.visibility,
    status: snapshot.status,
    settings: snapshot.settings,
    branding: snapshot.branding,
    preferences: snapshot.preferences,
    features: snapshot.features,
    agentBindings: snapshot.agentBindings,
    knowledgeBindings: snapshot.knowledgeBindings,
    workflowBindings: snapshot.workflowBindings,
    searchBinding: snapshot.searchBinding ?? null,
    notificationBinding: snapshot.notificationBinding ?? null,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link WorkspaceRepository} implementation. */
export class PgWorkspaceRepository implements WorkspaceRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: WorkspaceId): Promise<Workspace | undefined> {
    const row = await this.#db.query.workspaces.findFirst({
      where: eq(workspaces.id, id),
    });
    return row === undefined ? undefined : Workspace.hydrate(rowToWorkspaceSnapshot(row));
  }

  async findBySlug(organizationId: TenantId, slug: WorkspaceSlug): Promise<Workspace | undefined> {
    const row = await this.#db.query.workspaces.findFirst({
      where: and(eq(workspaces.organizationId, organizationId), eq(workspaces.slug, slug.value)),
    });
    return row === undefined ? undefined : Workspace.hydrate(rowToWorkspaceSnapshot(row));
  }

  async existsBySlug(organizationId: TenantId, slug: WorkspaceSlug): Promise<boolean> {
    const row = await this.#db.query.workspaces.findFirst({
      where: and(eq(workspaces.organizationId, organizationId), eq(workspaces.slug, slug.value)),
    });
    return row !== undefined;
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly Workspace[]> {
    const rows = await this.#db.query.workspaces.findMany({
      where: eq(workspaces.organizationId, organizationId),
      // Deterministic order: the dashboard default-workspace selection
      // relies on the earliest-created workspace being first.
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });
    return rows.map((row) => Workspace.hydrate(rowToWorkspaceSnapshot(row)));
  }

  async listByIds(ids: readonly WorkspaceId[]): Promise<readonly Workspace[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.#db.query.workspaces.findMany({
      where: inArray(workspaces.id, [...ids]),
    });
    return rows.map((row) => Workspace.hydrate(rowToWorkspaceSnapshot(row)));
  }

  async save(workspace: Workspace): Promise<void> {
    const row = workspaceSnapshotToRow(Workspace.snapshot(workspace));
    await this.#db
      .insert(workspaces)
      .values(row)
      .onConflictDoUpdate({ target: workspaces.id, set: row });
  }
}

/** Maps a membership row to a {@link WorkspaceMembership} snapshot. */
function rowToMembershipSnapshot(
  row: MembershipRow,
): ReturnType<typeof WorkspaceMembership.snapshot> {
  return {
    id: row.id,
    workspaceId: WorkspaceId.from(row.workspaceId),
    userId: row.userId as UserId,
    role: row.role as 'owner' | 'admin' | 'member',
    joinedAt: toIso(row.joinedAt),
    version: row.version,
  };
}

/** Maps a {@link WorkspaceMembership} snapshot to a membership row. */
function membershipSnapshotToRow(
  snapshot: ReturnType<typeof WorkspaceMembership.snapshot>,
): MembershipRow {
  return {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    userId: snapshot.userId,
    role: snapshot.role,
    joinedAt: toDate(snapshot.joinedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link WorkspaceMembershipRepository} implementation. */
export class PgWorkspaceMembershipRepository implements WorkspaceMembershipRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: string): Promise<WorkspaceMembership | undefined> {
    const row = await this.#db.query.workspaceMemberships.findFirst({
      where: eq(workspaceMemberships.id, id),
    });
    return row === undefined
      ? undefined
      : WorkspaceMembership.hydrate(rowToMembershipSnapshot(row));
  }

  async findByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<WorkspaceMembership | undefined> {
    const row = await this.#db.query.workspaceMemberships.findFirst({
      where: and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, userId),
      ),
    });
    return row === undefined
      ? undefined
      : WorkspaceMembership.hydrate(rowToMembershipSnapshot(row));
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly WorkspaceMembership[]> {
    const rows = await this.#db.query.workspaceMemberships.findMany({
      where: eq(workspaceMemberships.workspaceId, workspaceId),
    });
    return rows.map((row) => WorkspaceMembership.hydrate(rowToMembershipSnapshot(row)));
  }

  async listByUser(userId: UserId): Promise<readonly WorkspaceMembership[]> {
    const rows = await this.#db.query.workspaceMemberships.findMany({
      where: eq(workspaceMemberships.userId, userId),
    });
    return rows.map((row) => WorkspaceMembership.hydrate(rowToMembershipSnapshot(row)));
  }

  async countOwners(workspaceId: WorkspaceId): Promise<number> {
    const rows = await this.#db.query.workspaceMemberships.findMany({
      where: and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.role, 'owner'),
      ),
    });
    return rows.length;
  }

  async save(membership: WorkspaceMembership): Promise<void> {
    const row = membershipSnapshotToRow(WorkspaceMembership.snapshot(membership));
    await this.#db
      .insert(workspaceMemberships)
      .values(row)
      .onConflictDoUpdate({ target: workspaceMemberships.id, set: row });
  }

  async remove(membership: WorkspaceMembership): Promise<void> {
    await this.#db.delete(workspaceMemberships).where(eq(workspaceMemberships.id, membership.id));
  }
}

/** Maps an installation row to a {@link WorkspaceInstallation} snapshot. */
function rowToInstallationSnapshot(
  row: InstallationRow,
): ReturnType<typeof WorkspaceInstallation.snapshot> {
  return {
    id: row.id,
    workspaceId: WorkspaceId.from(row.workspaceId),
    pluginId: row.pluginId,
    pluginVersion: row.pluginVersion,
    installedAt: toIso(row.installedAt),
    version: row.version,
  };
}

/** Maps a {@link WorkspaceInstallation} snapshot to an installation row. */
function installationSnapshotToRow(
  snapshot: ReturnType<typeof WorkspaceInstallation.snapshot>,
): InstallationRow {
  return {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    pluginId: snapshot.pluginId,
    pluginVersion: snapshot.pluginVersion,
    installedAt: toDate(snapshot.installedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link WorkspaceInstallationRepository} implementation. */
export class PgWorkspaceInstallationRepository implements WorkspaceInstallationRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: string): Promise<WorkspaceInstallation | undefined> {
    const row = await this.#db.query.workspaceInstallations.findFirst({
      where: eq(workspaceInstallations.id, id),
    });
    return row === undefined
      ? undefined
      : WorkspaceInstallation.hydrate(rowToInstallationSnapshot(row));
  }

  async findByWorkspaceAndPlugin(
    workspaceId: WorkspaceId,
    pluginId: string,
  ): Promise<WorkspaceInstallation | undefined> {
    const row = await this.#db.query.workspaceInstallations.findFirst({
      where: and(
        eq(workspaceInstallations.workspaceId, workspaceId),
        eq(workspaceInstallations.pluginId, pluginId),
      ),
    });
    return row === undefined
      ? undefined
      : WorkspaceInstallation.hydrate(rowToInstallationSnapshot(row));
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly WorkspaceInstallation[]> {
    const rows = await this.#db.query.workspaceInstallations.findMany({
      where: eq(workspaceInstallations.workspaceId, workspaceId),
    });
    return rows.map((row) => WorkspaceInstallation.hydrate(rowToInstallationSnapshot(row)));
  }

  async save(installation: WorkspaceInstallation): Promise<void> {
    const row = installationSnapshotToRow(WorkspaceInstallation.snapshot(installation));
    await this.#db
      .insert(workspaceInstallations)
      .values(row)
      .onConflictDoUpdate({ target: workspaceInstallations.id, set: row });
  }

  async remove(installation: WorkspaceInstallation): Promise<void> {
    await this.#db
      .delete(workspaceInstallations)
      .where(eq(workspaceInstallations.id, installation.id));
  }
}
