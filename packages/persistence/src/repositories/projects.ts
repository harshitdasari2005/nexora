/**
 * @nexora/persistence — projects repository.
 *
 * Drizzle implementation of the Projects domain repository interface
 * (`ProjectRepository`). Aggregates are serialized via `snapshot()` and
 * reconstructed via `hydrate()` (PERSISTENCE.md §4 aggregate ownership).
 */

import { and, eq, ilike } from 'drizzle-orm';
import type { TenantId } from '@nexora/contracts/common';
import type { ProjectRepository } from '@nexora/domain-projects';
import {
  Project,
  ProjectId,
  ProjectName,
  ProjectStatus,
  ProjectDescription,
} from '@nexora/domain-projects';

import type { NexoraDatabase } from '../db.js';
import { projects } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

type ProjectRow = typeof projects.$inferSelect;

/** Maps a projects row to a {@link Project} snapshot. */
function rowToProjectSnapshot(row: ProjectRow): ReturnType<typeof Project.snapshot> {
  return {
    id: ProjectId.from(row.id),
    organizationId: row.organizationId as TenantId,
    name: ProjectName.create(row.name).value,
    description:
      row.description === null ? undefined : ProjectDescription.create(row.description).value,
    status: ProjectStatus.from(row.status).value,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Maps a {@link Project} snapshot to a projects row. */
function projectSnapshotToRow(snapshot: ReturnType<typeof Project.snapshot>): ProjectRow {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    name: snapshot.name,
    description: snapshot.description ?? null,
    status: snapshot.status,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link ProjectRepository} implementation. */
export class PgProjectRepository implements ProjectRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: ProjectId): Promise<Project | undefined> {
    const row = await this.#db.query.projects.findFirst({
      where: eq(projects.id, id),
    });
    return row === undefined ? undefined : Project.hydrate(rowToProjectSnapshot(row));
  }

  async findByName(organizationId: TenantId, name: string): Promise<readonly Project[]> {
    const term = name.trim();
    if (term.length === 0) {
      return [];
    }
    const rows = await this.#db.query.projects.findMany({
      where: and(
        eq(projects.organizationId, organizationId),
        // Case-insensitive substring match (ilike on the raw column).
        ilike(projects.name, `%${term}%`),
      ),
      // Deterministic order: oldest first keeps resolution stable.
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });
    return rows.map((row) => Project.hydrate(rowToProjectSnapshot(row)));
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly Project[]> {
    const rows = await this.#db.query.projects.findMany({
      where: eq(projects.organizationId, organizationId),
      // Deterministic order: newest first is the natural project list order.
      orderBy: (table, { desc }) => [desc(table.createdAt), desc(table.id)],
    });
    return rows.map((row) => Project.hydrate(rowToProjectSnapshot(row)));
  }

  async save(project: Project): Promise<void> {
    const row = projectSnapshotToRow(Project.snapshot(project));
    await this.#db
      .insert(projects)
      .values(row)
      .onConflictDoUpdate({ target: projects.id, set: row });
  }
}
