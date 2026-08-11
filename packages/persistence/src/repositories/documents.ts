/**
 * @nexora/persistence — documents repository.
 *
 * Drizzle implementation of the Documents domain repository interface
 * (`DocumentRepository`). Aggregates are serialized via `snapshot()` and
 * reconstructed via `hydrate()` (PERSISTENCE.md §4 aggregate ownership).
 * Every read is scope-bound: the workspace is part of the query, never
 * optional.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { DocumentRepository } from '@nexora/domain-documents';
import {
  Document,
  DocumentId,
  DocumentStatus,
  DocumentTitle,
  ContentRef,
} from '@nexora/domain-documents';

import type { NexoraDatabase } from '../db.js';
import { documents } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

type DocumentRow = typeof documents.$inferSelect;

/** Maps a documents row to a {@link Document} snapshot. */
function rowToDocumentSnapshot(row: DocumentRow): ReturnType<typeof Document.snapshot> {
  return {
    id: DocumentId.from(row.id),
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    uploaderId: row.uploaderId as Document['uploaderId'],
    title: DocumentTitle.create(row.title).value,
    contentType: row.contentType,
    contentRef: ContentRef.create(row.contentRef).value,
    status: DocumentStatus.from(row.status).value,
    failureReason: row.failureReason ?? undefined,
    contentVersion: row.contentVersion,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Maps a {@link Document} snapshot to a documents row. */
function documentSnapshotToRow(snapshot: ReturnType<typeof Document.snapshot>): DocumentRow {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    workspaceId: snapshot.workspaceId,
    uploaderId: snapshot.uploaderId,
    title: snapshot.title,
    contentType: snapshot.contentType,
    contentRef: snapshot.contentRef,
    status: snapshot.status,
    failureReason: snapshot.failureReason ?? null,
    contentVersion: snapshot.contentVersion,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link DocumentRepository} implementation. */
export class PgDocumentRepository implements DocumentRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: Document['id']): Promise<Document | undefined> {
    const row = await this.#db.query.documents.findFirst({
      where: eq(documents.id, id),
    });
    return row === undefined ? undefined : Document.hydrate(rowToDocumentSnapshot(row));
  }

  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly Document[]> {
    const rows = await this.#db.query.documents.findMany({
      where: and(
        eq(documents.organizationId, organizationId),
        eq(documents.workspaceId, workspaceId),
      ),
      // Deterministic order: newest first is the natural document list order.
      orderBy: [desc(documents.createdAt), desc(documents.id)],
    });
    return rows.map((row) => Document.hydrate(rowToDocumentSnapshot(row)));
  }

  async save(document: Document): Promise<void> {
    const row = documentSnapshotToRow(Document.snapshot(document));
    await this.#db
      .insert(documents)
      .values(row)
      .onConflictDoUpdate({ target: documents.id, set: row });
  }
}
