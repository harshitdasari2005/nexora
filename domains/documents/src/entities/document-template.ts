/**
 * @nexora/domain-documents — DocumentTemplate aggregate.
 *
 * A reusable document starter within a tenant + workspace (S17 Documents
 * vertical slice: templates). A template holds metadata (name, description,
 * content type) plus an opaque storage reference to its starter content —
 * the domain never sees bytes. Lifecycle is `active → archived` (archived is
 * terminal in v1, and is DISTINCT from a document's `archived` lifecycle).
 *
 * Authorization is never derived from template content: the aggregate
 * carries its scope explicitly (organizationId + workspaceId, immutable),
 * and every read/write is gated by the trusted tenant + workspace. The model
 * can never choose identity — scope is always server-side.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import { prefixedId } from '@nexora/shared/ids';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import type { DocumentEventContext } from '../events/index.js';
import { documentTemplateArchivedEvent, documentTemplateCreatedEvent } from '../events/index.js';
import { DocumentStateTransitionError, InvalidDocumentValueError } from '../errors/index.js';
import { ContentRef } from '../value-objects/content-ref.js';
import {
  DOCUMENT_TEMPLATE_STATUSES,
  DocumentTemplateStatus,
} from '../value-objects/document-template-status.js';

/** The maximum template description length. */
export const DOCUMENT_TEMPLATE_DESCRIPTION_MAX_LENGTH = 2_000;

/** Input for creating a new {@link DocumentTemplate}. */
export interface CreateDocumentTemplateInput {
  /** The owning organization (tenant) id — immutable. */
  organizationId: TenantId;
  /** The owning workspace id — immutable (workspace isolation). */
  workspaceId: WorkspaceId;
  /** The user that created the template. */
  createdBy: UserId;
  /** The template name (validated, unique per workspace is caller's concern). */
  name: string;
  /** An optional human-readable description. */
  description?: string;
  /** The starter content type (e.g. `text/markdown`). */
  contentType: string;
  /** The storage reference of the starter content. */
  contentRef: string;
}

/** A persistence snapshot of the {@link DocumentTemplate} aggregate. */
export interface DocumentTemplateSnapshot {
  /** The template id. */
  id: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The user that created the template. */
  createdBy: UserId;
  /** The template name. */
  name: string;
  /** An optional human-readable description. */
  description?: string;
  /** The starter content type. */
  contentType: string;
  /** The storage reference of the starter content. */
  contentRef: string;
  /** The lifecycle status value. */
  status: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link DocumentTemplate} aggregate. Use {@link DocumentTemplate.create}
 * to construct; mutate only through aggregate methods.
 */
export class DocumentTemplate {
  // Not `readonly`: reassigned by `hydrate` (reconstitution reuses the
  // persisted id).
  #id: string;
  readonly #organizationId: TenantId;
  readonly #workspaceId: WorkspaceId;
  readonly #createdBy: UserId;
  readonly #name: string;
  readonly #description?: string;
  readonly #contentType: string;
  readonly #contentRef: ContentRef;
  #status: DocumentTemplateStatus;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateDocumentTemplateInput, createdAt: string) {
    this.#id = DocumentTemplateId.create();
    this.#organizationId = input.organizationId;
    this.#workspaceId = input.workspaceId;
    this.#createdBy = input.createdBy;
    this.#name = validateTemplateName(input.name);
    this.#description = normalizeDescription(input.description);
    this.#contentType = input.contentType.trim();
    this.#contentRef = ContentRef.create(input.contentRef);
    this.#status = DocumentTemplateStatus.active();
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates an `active` template and records a
   * {@link documentTemplateCreatedEvent}.
   */
  static create(
    input: CreateDocumentTemplateInput,
    context: DocumentEventContext,
    now = nowIso(),
  ): DocumentTemplate {
    const template = new DocumentTemplate(input, now);
    template.#events.push(
      documentTemplateCreatedEvent(context, template.#id, {
        templateId: template.#id,
        organizationId: template.#organizationId,
        workspaceId: template.#workspaceId,
        name: template.#name,
        status: template.#status.value,
      }),
    );
    return template;
  }

  /** The template id. */
  get id(): string {
    return this.#id;
  }

  /** The owning organization (tenant) id — immutable. */
  get organizationId(): TenantId {
    return this.#organizationId;
  }

  /** The owning workspace id — immutable (workspace isolation). */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The user that created the template. */
  get createdBy(): UserId {
    return this.#createdBy;
  }

  /** The template name. */
  get name(): string {
    return this.#name;
  }

  /** An optional human-readable description. */
  get description(): string | undefined {
    return this.#description;
  }

  /** The starter content type. */
  get contentType(): string {
    return this.#contentType;
  }

  /** The storage reference of the starter content. */
  get contentRef(): ContentRef {
    return this.#contentRef;
  }

  /** The lifecycle status. */
  get status(): DocumentTemplateStatus {
    return this.#status;
  }

  /** Whether the template can be used to create documents. */
  isActive(): boolean {
    return this.#status.isActive();
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC last mutation time. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version for optimistic concurrency. */
  get version(): number {
    return this.#version;
  }

  /**
   * Archives the template (`active` → `archived` — removed from the picker;
   * terminal in v1) and records a {@link documentTemplateArchivedEvent}.
   *
   * @throws {DocumentStateTransitionError} when the template is not active.
   */
  archive(context: DocumentEventContext, now = nowIso()): void {
    if (!this.#status.isActive()) {
      throw new DocumentStateTransitionError(
        `Cannot archive a template in status ${this.#status.value}`,
        { templateId: this.#id, status: this.#status.value },
      );
    }
    this.#status = DocumentTemplateStatus.archived();
    this.#version += 1;
    this.#updatedAt = now;
    this.#events.push(documentTemplateArchivedEvent(context, this.#id));
  }

  /** Produces a persistence snapshot of the template. */
  static snapshot(template: DocumentTemplate): DocumentTemplateSnapshot {
    return {
      id: template.id,
      organizationId: template.organizationId,
      workspaceId: template.workspaceId,
      createdBy: template.createdBy,
      name: template.name,
      description: template.description,
      contentType: template.contentType,
      contentRef: template.contentRef.value,
      status: template.status.value,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      version: template.version,
    };
  }

  /** Reconstructs a {@link DocumentTemplate} from a snapshot without events. */
  static hydrate(snapshot: DocumentTemplateSnapshot): DocumentTemplate {
    const template = new DocumentTemplate(
      {
        organizationId: snapshot.organizationId,
        workspaceId: snapshot.workspaceId,
        createdBy: snapshot.createdBy,
        name: snapshot.name,
        description: snapshot.description,
        contentType: snapshot.contentType,
        contentRef: snapshot.contentRef,
      },
      snapshot.createdAt,
    );
    template.#id = snapshot.id;
    template.#status = DocumentTemplateStatus.from(snapshot.status);
    template.#updatedAt = snapshot.updatedAt;
    template.#version = snapshot.version;
    return template;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }
}

/** The template id factory (`tpl_...`). */
export const DocumentTemplateId = {
  /** Generates a new unique template id. */
  create(): string {
    return prefixedId('tpl');
  },

  /**
   * Reconstructs a template id from a stored string.
   *
   * @throws {InvalidDocumentValueError} when the value is empty.
   */
  from(value: string): string {
    if (value.length === 0) {
      throw new InvalidDocumentValueError('Invalid template id', [
        { path: 'templateId', message: 'Must not be empty' },
      ]);
    }
    return value;
  },
};

/** Validates a template name (required, bounded). */
function validateTemplateName(name: string): string {
  const value = name.trim();
  if (value.length === 0 || value.length > 200) {
    throw new InvalidDocumentValueError('Invalid template name', [
      { path: 'name', message: 'Must be between 1 and 200 characters' },
    ]);
  }
  return value;
}

/** Normalizes an optional description (empty → undefined, bounded). */
function normalizeDescription(description: string | undefined): string | undefined {
  const value = description?.trim();
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (value.length > DOCUMENT_TEMPLATE_DESCRIPTION_MAX_LENGTH) {
    throw new InvalidDocumentValueError('Invalid template description', [
      {
        path: 'description',
        message: `Must be at most ${DOCUMENT_TEMPLATE_DESCRIPTION_MAX_LENGTH} characters`,
      },
    ]);
  }
  return value;
}

/** Re-export the status vocabulary for convenience. */
export { DOCUMENT_TEMPLATE_STATUSES };
