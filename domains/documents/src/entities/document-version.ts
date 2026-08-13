/**
 * @nexora/domain-documents — DocumentVersion aggregate.
 *
 * An immutable content-revision record of a {@link Document} (S17 Documents
 * vertical slice: version history). One row per persisted content revision:
 *
 * - Version numbers are monotonic (next = max + 1, enforced by the domain
 *   service and a unique (document, version) persistence constraint).
 * - Historical versions are IMMUTABLE — the aggregate exposes no mutation
 *   methods; a restore NEVER mutates a historical record (it creates a new
 *   current version whose content is copied).
 * - The version records the storage key (ContentRef) of its bytes, so
 *   version content remains retrievable through the storage port.
 *
 * The aggregate carries the trusted tenant + workspace scope explicitly;
 * every read/write is gated by the caller's trusted scope, and an invalid
 * (document, version) combination resolves to NOT FOUND — never to another
 * workspace's record.
 *
 * The version record is a write-behind history projection: it emits no
 * events of its own. The {@link Document} aggregate emits the authoritative
 * content-change events (`document.version_uploaded` /
 * `document.version_restored`).
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import { InvalidDocumentValueError } from '../errors/index.js';
import { ContentRef } from '../value-objects/content-ref.js';
import type { DocumentId } from '../value-objects/document-id.js';

/** Input for creating a new {@link DocumentVersion}. */
export interface CreateDocumentVersionInput {
  /** The owning document id. */
  documentId: DocumentId;
  /** The owning organization (tenant) id — immutable. */
  organizationId: TenantId;
  /** The owning workspace id — immutable (workspace isolation). */
  workspaceId: WorkspaceId;
  /** The content revision number (monotonic, 1-based). */
  version: number;
  /** The storage reference of this revision's binary content. */
  contentRef: string;
  /** The content type of this revision. */
  contentType: string;
  /** The historical version this revision was restored from, when applicable. */
  restoredFromVersion?: number;
  /** The user that created the revision. */
  createdBy: UserId;
}

/** A persistence snapshot of the {@link DocumentVersion} aggregate. */
export interface DocumentVersionSnapshot {
  /** The version record id. */
  id: string;
  /** The owning document id. */
  documentId: DocumentId;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The content revision number. */
  version: number;
  /** The storage reference of the revision's binary content. */
  contentRef: string;
  /** The content type of the revision. */
  contentType: string;
  /** The historical version this revision was restored from, when applicable. */
  restoredFromVersion?: number;
  /** The user that created the revision. */
  createdBy: UserId;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/**
 * The immutable {@link DocumentVersion} aggregate. Construct with
 * {@link DocumentVersion.create}; it has NO mutation methods by design —
 * history is write-once.
 */
export class DocumentVersion {
  // Not `readonly`: reassigned by `hydrate` (reconstitution reuses the
  // persisted id).
  #id: string;
  readonly #documentId: DocumentId;
  readonly #organizationId: TenantId;
  readonly #workspaceId: WorkspaceId;
  readonly #version: number;
  readonly #contentRef: ContentRef;
  readonly #contentType: string;
  readonly #restoredFromVersion?: number;
  readonly #createdBy: UserId;
  readonly #createdAt: string;

  private constructor(input: CreateDocumentVersionInput, createdAt: string) {
    this.#id = DocumentVersionId.create();
    this.#documentId = input.documentId;
    this.#organizationId = input.organizationId;
    this.#workspaceId = input.workspaceId;
    this.#version = validateVersion(input.version);
    this.#contentRef = ContentRef.create(input.contentRef);
    this.#contentType = input.contentType.trim();
    if (input.restoredFromVersion !== undefined) {
      this.#restoredFromVersion = validateVersion(input.restoredFromVersion);
    }
    this.#createdBy = input.createdBy;
    this.#createdAt = createdAt;
  }

  /** Records a new immutable content revision (no events — see the header). */
  static create(input: CreateDocumentVersionInput, now = nowIso()): DocumentVersion {
    return new DocumentVersion(input, now);
  }

  /** The version record id. */
  get id(): string {
    return this.#id;
  }

  /** The owning document id. */
  get documentId(): DocumentId {
    return this.#documentId;
  }

  /** The owning organization (tenant) id — immutable. */
  get organizationId(): TenantId {
    return this.#organizationId;
  }

  /** The owning workspace id — immutable (workspace isolation). */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The content revision number. */
  get version(): number {
    return this.#version;
  }

  /** The storage reference of this revision's binary content. */
  get contentRef(): ContentRef {
    return this.#contentRef;
  }

  /** The content type of this revision. */
  get contentType(): string {
    return this.#contentType;
  }

  /** The historical version this revision was restored from, when applicable. */
  get restoredFromVersion(): number | undefined {
    return this.#restoredFromVersion;
  }

  /** The user that created the revision. */
  get createdBy(): UserId {
    return this.#createdBy;
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** Produces a persistence snapshot of the version. */
  static snapshot(version: DocumentVersion): DocumentVersionSnapshot {
    return {
      id: version.id,
      documentId: version.documentId,
      organizationId: version.organizationId,
      workspaceId: version.workspaceId,
      version: version.version,
      contentRef: version.contentRef.value,
      contentType: version.contentType,
      restoredFromVersion: version.restoredFromVersion,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
    };
  }

  /** Reconstructs a {@link DocumentVersion} from a snapshot without events. */
  static hydrate(snapshot: DocumentVersionSnapshot): DocumentVersion {
    const version = new DocumentVersion(
      {
        documentId: snapshot.documentId,
        organizationId: snapshot.organizationId,
        workspaceId: snapshot.workspaceId,
        version: snapshot.version,
        contentRef: snapshot.contentRef,
        contentType: snapshot.contentType,
        restoredFromVersion: snapshot.restoredFromVersion,
        createdBy: snapshot.createdBy,
      },
      snapshot.createdAt,
    );
    version.#id = snapshot.id;
    return version;
  }
}

/** The version record id factory (opaque, prefixed). */
export const DocumentVersionId = {
  /** Generates a new unique version-record id (`docver_...`). */
  create(): string {
    return prefixedId('docver');
  },

  /** Reconstructs a version-record id from a stored string. */
  from(value: string): string {
    if (value.length === 0) {
      throw new InvalidDocumentValueError('Invalid version record id', [
        { path: 'id', message: 'Must not be empty' },
      ]);
    }
    return value;
  },
};

/** A monotonic version number must be a positive integer. */
export function validateVersion(version: number): number {
  if (!Number.isInteger(version) || version <= 0) {
    throw new InvalidDocumentValueError('Version must be a positive integer', [
      { path: 'version', message: 'Must be a positive integer' },
    ]);
  }
  return version;
}
