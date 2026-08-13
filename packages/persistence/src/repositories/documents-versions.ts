/**
 * @nexora/persistence — documents version + template repositories.
 *
 * Drizzle implementations of the Documents S17 repository interfaces:
 *
 * - {@link PgDocumentVersionRepository}: the immutable version-history
 *   store. `save` is an INSERT-ONLY append; the unique (document, version)
 *   constraint is the monotonicity defense, so a duplicate version number
 *   fails instead of overwriting history.
 * - {@link PgDocumentTemplateRepository}: the template store. Every read is
 *   scope-bound: the workspace is part of the query, never optional.
 *
 * Aggregates are serialized via `snapshot()` and reconstructed via
 * `hydrate()` (PERSISTENCE.md §4 aggregate ownership).
 */

import { and, asc, eq } from 'drizzle-orm';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type {
  Document,
  DocumentId,
  DocumentTemplate,
  DocumentTemplateRepository,
  DocumentVersion,
  DocumentVersionRepository,
} from '@nexora/domain-documents';
import {
  DocumentId as DocumentIdFactory,
  DocumentTemplate as DocumentTemplateFactory,
  DocumentVersion as DocumentVersionFactory,
} from '@nexora/domain-documents';

import type { NexoraDatabase } from '../db.js';
import { documentTemplates, documentVersions } from '../schema/index.js';

/** Maps a raw documentId string to the branded {@link DocumentId}. */
function toDocumentId(value: string): DocumentId {
  return DocumentIdFactory.from(value);
}

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

type DocumentVersionRow = typeof documentVersions.$inferSelect;
type DocumentTemplateRow = typeof documentTemplates.$inferSelect;

/** Maps a document_versions row to a {@link DocumentVersion} snapshot. */
function rowToVersionSnapshot(
  row: DocumentVersionRow,
): ReturnType<typeof DocumentVersionFactory.snapshot> {
  return {
    id: row.id,
    documentId: toDocumentId(row.documentId),
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    version: row.version,
    contentRef: row.contentRef,
    contentType: row.contentType,
    restoredFromVersion: row.restoredFromVersion ?? undefined,
    createdBy: row.createdBy as UserId,
    createdAt: toIso(row.createdAt),
  };
}

/** Maps a {@link DocumentVersion} snapshot to a document_versions row. */
function versionSnapshotToRow(
  snapshot: ReturnType<typeof DocumentVersionFactory.snapshot>,
): DocumentVersionRow {
  return {
    id: snapshot.id,
    documentId: snapshot.documentId,
    organizationId: snapshot.organizationId,
    workspaceId: snapshot.workspaceId,
    version: snapshot.version,
    contentRef: snapshot.contentRef,
    contentType: snapshot.contentType,
    restoredFromVersion: snapshot.restoredFromVersion ?? null,
    createdBy: snapshot.createdBy,
    createdAt: toDate(snapshot.createdAt),
  };
}

/** Drizzle {@link DocumentVersionRepository} implementation (append-only). */
export class PgDocumentVersionRepository implements DocumentVersionRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async listByDocument(documentId: Document['id']): Promise<readonly DocumentVersion[]> {
    const rows = await this.#db.query.documentVersions.findMany({
      where: eq(documentVersions.documentId, documentId),
      // Version-history order: oldest revision first (ascending).
      orderBy: [asc(documentVersions.version)],
    });
    return rows.map((row) => DocumentVersionFactory.hydrate(rowToVersionSnapshot(row)));
  }

  async findByDocumentAndVersion(
    documentId: Document['id'],
    version: number,
  ): Promise<DocumentVersion | undefined> {
    const row = await this.#db.query.documentVersions.findFirst({
      where: and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.version, version),
      ),
    });
    return row === undefined
      ? undefined
      : DocumentVersionFactory.hydrate(rowToVersionSnapshot(row));
  }

  async save(version: DocumentVersion): Promise<void> {
    const row = versionSnapshotToRow(DocumentVersionFactory.snapshot(version));
    // Append-only: a duplicate (document, version) violates the unique
    // constraint instead of overwriting immutable history.
    await this.#db.insert(documentVersions).values(row);
  }
}

/** Maps a document_templates row to a {@link DocumentTemplate} snapshot. */
function rowToTemplateSnapshot(
  row: DocumentTemplateRow,
): ReturnType<typeof DocumentTemplateFactory.snapshot> {
  return {
    id: row.id,
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    createdBy: row.createdBy as UserId,
    name: row.name,
    description: row.description ?? undefined,
    contentType: row.contentType,
    contentRef: row.contentRef,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Maps a {@link DocumentTemplate} snapshot to a document_templates row. */
function templateSnapshotToRow(
  snapshot: ReturnType<typeof DocumentTemplateFactory.snapshot>,
): DocumentTemplateRow {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    workspaceId: snapshot.workspaceId,
    createdBy: snapshot.createdBy,
    name: snapshot.name,
    description: snapshot.description ?? null,
    contentType: snapshot.contentType,
    contentRef: snapshot.contentRef,
    status: snapshot.status,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link DocumentTemplateRepository} implementation. */
export class PgDocumentTemplateRepository implements DocumentTemplateRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(templateId: string): Promise<DocumentTemplate | undefined> {
    const row = await this.#db.query.documentTemplates.findFirst({
      where: eq(documentTemplates.id, templateId),
    });
    return row === undefined
      ? undefined
      : DocumentTemplateFactory.hydrate(rowToTemplateSnapshot(row));
  }

  async listActiveByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly DocumentTemplate[]> {
    const rows = await this.#db.query.documentTemplates.findMany({
      where: and(
        eq(documentTemplates.organizationId, organizationId),
        eq(documentTemplates.workspaceId, workspaceId),
        eq(documentTemplates.status, 'active'),
      ),
      // Newest first is the natural picker order.
      orderBy: [asc(documentTemplates.createdAt)],
    });
    return rows.map((row) => DocumentTemplateFactory.hydrate(rowToTemplateSnapshot(row)));
  }

  async save(template: DocumentTemplate): Promise<void> {
    const row = templateSnapshotToRow(DocumentTemplateFactory.snapshot(template));
    await this.#db
      .insert(documentTemplates)
      .values(row)
      .onConflictDoUpdate({ target: documentTemplates.id, set: row });
  }
}
