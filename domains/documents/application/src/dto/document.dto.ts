/**
 * @nexora/application-documents — document DTO.
 *
 * The public representation of a document returned by queries and APIs.
 * Internal aggregates never cross module boundaries, and the content
 * reference is never exposed — clients get metadata, not storage keys.
 */

import type { Document } from '@nexora/domain-documents';

/** The public document representation. */
export interface DocumentDto {
  /** The document id. */
  id: string;
  /** The owning organization (tenant) id. */
  organizationId: string;
  /** The owning workspace id. */
  workspaceId: string;
  /** The uploading user id. */
  uploaderId: string;
  /** The title. */
  title: string;
  /** The upload content type. */
  contentType: string;
  /** The lifecycle status (`uploaded` | `processing` | `available` | `failed` | `archived`). */
  status: string;
  /** A safe failure reason, when processing failed. */
  failureReason?: string;
  /**
   * The legacy processing counter (bumped on each successful processing).
   * The authoritative content-revision number is the current entry of the
   * document version history — `contentVersion` is `maxRevision + 1` and
   * must never be presented as the current version.
   */
  contentVersion: number;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** Maps a {@link Document} aggregate to its {@link DocumentDto}. */
export function toDocumentDto(document: Document): DocumentDto {
  return {
    id: document.id,
    organizationId: document.organizationId,
    workspaceId: document.workspaceId,
    uploaderId: document.uploaderId,
    title: document.title.value,
    contentType: document.contentType,
    status: document.status.value,
    failureReason: document.failureReason,
    contentVersion: document.contentVersion,
    createdAt: document.createdAt,
  };
}
