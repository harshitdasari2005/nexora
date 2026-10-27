/**
 * @nexora/persistence — office requests and project tasks.
 *
 * Drizzle implementations of `OfficeRequestRepository` (HR domain) and
 * `ProjectTaskRepository` (Projects domain). Updates are optimistic: a row is
 * written only while it is still at the version the aggregate was loaded at,
 * so two people acting at once cannot both win.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import {
  OfficeRequest,
  OfficeRequestId,
  type OfficeRequestRepository,
  type OfficeRequestSnapshot,
} from '@nexora/domain-hr';
import {
  ProjectTask,
  ProjectTaskId,
  type ProjectTaskRepository,
  type ProjectTaskSnapshot,
} from '@nexora/domain-projects';

import type { NexoraDatabase } from '../db.js';
import { officeRequests, projectTasks } from '../schema/index.js';

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

type RequestRow = typeof officeRequests.$inferSelect;

function requestToSnapshot(row: RequestRow): OfficeRequestSnapshot {
  return {
    id: OfficeRequestId.from(row.id),
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    requestedBy: row.requestedBy,
    details: row.details as OfficeRequestSnapshot['details'],
    stages: row.stages as OfficeRequestSnapshot['stages'],
    stageIndex: row.stageIndex,
    status: row.status as OfficeRequestSnapshot['status'],
    history: row.history as OfficeRequestSnapshot['history'],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Drizzle {@link OfficeRequestRepository} implementation. */
export class PgOfficeRequestRepository implements OfficeRequestRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: OfficeRequestId): Promise<OfficeRequest | undefined> {
    const rows = await this.#db
      .select()
      .from(officeRequests)
      .where(eq(officeRequests.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : OfficeRequest.hydrate(requestToSnapshot(row));
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly OfficeRequest[]> {
    const rows = await this.#db
      .select()
      .from(officeRequests)
      .where(eq(officeRequests.organizationId, organizationId))
      .orderBy(desc(officeRequests.createdAt), desc(officeRequests.id));
    return rows.map((row) => OfficeRequest.hydrate(requestToSnapshot(row)));
  }

  async insert(request: OfficeRequest): Promise<void> {
    const snapshot = OfficeRequest.snapshot(request);
    await this.#db.insert(officeRequests).values({
      id: snapshot.id,
      organizationId: snapshot.organizationId,
      workspaceId: snapshot.workspaceId,
      requestedBy: snapshot.requestedBy,
      type: snapshot.details.type,
      details: snapshot.details,
      stages: [...snapshot.stages],
      stageIndex: snapshot.stageIndex,
      status: snapshot.status,
      history: [...snapshot.history],
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
      version: snapshot.version,
    });
  }

  async update(request: OfficeRequest, expectedVersion: number): Promise<boolean> {
    const snapshot = OfficeRequest.snapshot(request);
    // Only what a request may change: who asked, for what and from where never is.
    const updated = await this.#db
      .update(officeRequests)
      .set({
        stageIndex: snapshot.stageIndex,
        status: snapshot.status,
        history: [...snapshot.history],
        updatedAt: new Date(snapshot.updatedAt),
        version: snapshot.version,
      })
      .where(
        and(
          eq(officeRequests.id, request.id),
          eq(officeRequests.organizationId, request.organizationId),
          eq(officeRequests.version, expectedVersion),
        ),
      )
      .returning({ id: officeRequests.id });
    return updated.length === 1;
  }
}

type TaskRow = typeof projectTasks.$inferSelect;

function taskToSnapshot(row: TaskRow): ProjectTaskSnapshot {
  return {
    id: ProjectTaskId.from(row.id),
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    projectId: row.projectId,
    title: row.title,
    ...(row.description === null ? {} : { description: row.description }),
    priority: row.priority as ProjectTaskSnapshot['priority'],
    ...(row.dueDate === null ? {} : { dueDate: row.dueDate }),
    assigneeId: row.assigneeId,
    createdBy: row.createdBy,
    status: row.status as ProjectTaskSnapshot['status'],
    history: row.history as ProjectTaskSnapshot['history'],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Drizzle {@link ProjectTaskRepository} implementation. */
export class PgProjectTaskRepository implements ProjectTaskRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: ProjectTaskId): Promise<ProjectTask | undefined> {
    const rows = await this.#db.select().from(projectTasks).where(eq(projectTasks.id, id)).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : ProjectTask.hydrate(taskToSnapshot(row));
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly ProjectTask[]> {
    const rows = await this.#db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.organizationId, organizationId))
      .orderBy(desc(projectTasks.createdAt), desc(projectTasks.id));
    return rows.map((row) => ProjectTask.hydrate(taskToSnapshot(row)));
  }

  async insert(task: ProjectTask): Promise<void> {
    const snapshot = ProjectTask.snapshot(task);
    await this.#db.insert(projectTasks).values({
      id: snapshot.id,
      organizationId: snapshot.organizationId,
      workspaceId: snapshot.workspaceId,
      projectId: snapshot.projectId,
      title: snapshot.title,
      description: snapshot.description ?? null,
      priority: snapshot.priority,
      dueDate: snapshot.dueDate ?? null,
      assigneeId: snapshot.assigneeId,
      createdBy: snapshot.createdBy,
      status: snapshot.status,
      history: [...snapshot.history],
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
      version: snapshot.version,
    });
  }

  async update(task: ProjectTask, expectedVersion: number): Promise<boolean> {
    const snapshot = ProjectTask.snapshot(task);
    const updated = await this.#db
      .update(projectTasks)
      .set({
        assigneeId: snapshot.assigneeId,
        status: snapshot.status,
        history: [...snapshot.history],
        updatedAt: new Date(snapshot.updatedAt),
        version: snapshot.version,
      })
      .where(
        and(
          eq(projectTasks.id, task.id),
          eq(projectTasks.organizationId, task.organizationId),
          eq(projectTasks.version, expectedVersion),
        ),
      )
      .returning({ id: projectTasks.id });
    return updated.length === 1;
  }
}
