/**
 * @nexora/application-documents — document version DTO.
 *
 * The public representation of an immutable content revision. The storage
 * reference is never exposed — clients get metadata only.
 */

import type { DocumentVersion } from '@nexora/domain-documents';

/** The public version-history representation. */
export interface DocumentVersionDto {
  /** The version record id. */
  id: string;
  /** The owning document id. */
  documentId: string;
  /** The monotonic content revision number. */
  version: number;
  /** The content type of the revision. */
  contentType: string;
  /** The historical version this revision was restored from, when applicable. */
  restoredFromVersion?: number;
  /** The user that created the revision. */
  createdBy: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** Maps a {@link DocumentVersion} aggregate to its {@link DocumentVersionDto}. */
export function toDocumentVersionDto(version: DocumentVersion): DocumentVersionDto {
  return {
    id: version.id,
    documentId: version.documentId,
    version: version.version,
    contentType: version.contentType,
    restoredFromVersion: version.restoredFromVersion,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
  };
}
