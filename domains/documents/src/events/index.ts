/**
 * @nexora/domain-documents — domain events.
 *
 * The Documents bounded context event vocabulary (DOMAIN_MODEL.md §14
 * Documents: `DocumentUploaded` plus the processing lifecycle). Documents is
 * a *Supporting* domain (DOMAIN_MODEL.md DOM-11), so document events ride
 * the canonical `@nexora/shared/events` envelope with category `documents`;
 * the platform event-bus (SAD.md §11) consumes this shape.
 *
 * Every event carries the organization (tenant) id (context contract) and
 * the document id. Events NEVER carry document content — the Knowledge
 * bounded context ingests by id/version through its own application layer.
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { DocumentId } from '../value-objects/document-id.js';

/** Category applied to every Documents domain event (DOM-11 Supporting). */
export const DOCUMENTS_EVENT_CATEGORY = 'documents' as const;

/** Stable event type names (EVT-* catalog, DOMAIN_MODEL.md §14). */
export const DOCUMENT_EVENT_TYPES = {
  documentUploaded: 'document.uploaded',
  documentProcessingStarted: 'document.processing_started',
  documentAvailable: 'document.available',
  documentProcessingFailed: 'document.processing_failed',
  documentArchived: 'document.archived',
  documentVersionUploaded: 'document.version_uploaded',
  documentVersionRestored: 'document.version_restored',
  documentTemplateCreated: 'document.template_created',
  documentTemplateArchived: 'document.template_archived',
} as const;

/** Payload of the {@link documentUploadedEvent}. */
export interface DocumentUploadedPayload {
  /** The uploaded document. */
  documentId: DocumentId;
  /** The title at upload time. */
  title: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The uploading user id. */
  uploaderId: string;
  /** The initial status (`uploaded`). */
  status: string;
}

/** Payload of the {@link documentProcessingStartedEvent}. */
export interface DocumentProcessingStartedPayload {
  /** The document being processed. */
  documentId: DocumentId;
}

/** Payload of the {@link documentAvailableEvent}. */
export interface DocumentAvailablePayload {
  /** The processed document. */
  documentId: DocumentId;
  /** The content version now available. */
  version: number;
}

/** Payload of the {@link documentProcessingFailedEvent}. */
export interface DocumentProcessingFailedPayload {
  /** The failed document. */
  documentId: DocumentId;
  /** A safe failure reason (never internal details). */
  reason: string;
}

/** Payload of the {@link documentArchivedEvent}. */
export interface DocumentArchivedPayload {
  /** The archived document. */
  documentId: DocumentId;
}

/** Payload of the {@link documentVersionUploadedEvent}. */
export interface DocumentVersionUploadedPayload {
  /** The document whose content changed. */
  documentId: DocumentId;
  /** The new current REVISION number (monotonic, from the version history). */
  version: number;
}

/** Payload of the {@link documentVersionRestoredEvent}. */
export interface DocumentVersionRestoredPayload {
  /** The document whose content was restored. */
  documentId: DocumentId;
  /** The new current REVISION number (a NEW revision — never a mutation of history). */
  version: number;
  /** The historical version the content was copied from. */
  restoredFromVersion: number;
}

/** Payload of the {@link documentTemplateCreatedEvent}. */
export interface DocumentTemplateCreatedPayload {
  /** The created template. */
  templateId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The template name. */
  name: string;
  /** The initial status (`active`). */
  status: string;
}

/** Payload of the {@link documentTemplateArchivedEvent}. */
export interface DocumentTemplateArchivedPayload {
  /** The archived template. */
  templateId: string;
}
export interface DocumentEventContext {
  /** The actor that caused the event. */
  actor: EventActor;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
}

/** Creates a typed Documents domain event envelope with canonical metadata. */
function documentEvent<P>(
  type: string,
  context: DocumentEventContext,
  entityId: string,
  payload: P,
  version = 1,
): EventEnvelope<P> {
  return createEventEnvelope({
    type,
    version,
    actor: context.actor,
    correlationId: context.correlationId,
    tenantId: context.organizationId,
    payload,
    metadata: {
      version,
      category: DOCUMENTS_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** A document was uploaded (document.uploaded — EVT-11). */
export function documentUploadedEvent(
  context: DocumentEventContext,
  documentId: DocumentId,
  payload: DocumentUploadedPayload,
): EventEnvelope<DocumentUploadedPayload> {
  return documentEvent(DOCUMENT_EVENT_TYPES.documentUploaded, context, documentId, payload);
}

/** Document processing started (document.processing_started). */
export function documentProcessingStartedEvent(
  context: DocumentEventContext,
  documentId: DocumentId,
): EventEnvelope<DocumentProcessingStartedPayload> {
  return documentEvent(DOCUMENT_EVENT_TYPES.documentProcessingStarted, context, documentId, {
    documentId,
  });
}

/** Document processing completed (document.available — indexable now). */
export function documentAvailableEvent(
  context: DocumentEventContext,
  documentId: DocumentId,
  version: number,
): EventEnvelope<DocumentAvailablePayload> {
  return documentEvent(DOCUMENT_EVENT_TYPES.documentAvailable, context, documentId, {
    documentId,
    version,
  });
}

/** Document processing failed (document.processing_failed — retryable). */
export function documentProcessingFailedEvent(
  context: DocumentEventContext,
  documentId: DocumentId,
  reason: string,
): EventEnvelope<DocumentProcessingFailedPayload> {
  return documentEvent(DOCUMENT_EVENT_TYPES.documentProcessingFailed, context, documentId, {
    documentId,
    reason,
  });
}

/** A document was archived (document.archived — leaves the index). */
export function documentArchivedEvent(
  context: DocumentEventContext,
  documentId: DocumentId,
): EventEnvelope<DocumentArchivedPayload> {
  return documentEvent(DOCUMENT_EVENT_TYPES.documentArchived, context, documentId, {
    documentId,
  });
}

/**
 * New content was adopted as the current revision (document.version_uploaded).
 * Emitted by the aggregate on `uploadNewContent` — historical versions are
 * never touched. `version` is the adopted REVISION number (the application
 * passes it in); the aggregate's legacy `contentVersion` counter is never
 * used as the revision.
 */
export function documentVersionUploadedEvent(
  context: DocumentEventContext,
  documentId: DocumentId,
  version: number,
): EventEnvelope<DocumentVersionUploadedPayload> {
  return documentEvent(DOCUMENT_EVENT_TYPES.documentVersionUploaded, context, documentId, {
    documentId,
    version,
  });
}

/**
 * A historical version's content was restored as a NEW current version
 * (document.version_restored). The historical version stays immutable —
 * restore never mutates history. `version` is the adopted REVISION number;
 * the aggregate's legacy `contentVersion` counter is never used as the
 * revision.
 */
export function documentVersionRestoredEvent(
  context: DocumentEventContext,
  documentId: DocumentId,
  version: number,
  restoredFromVersion: number,
): EventEnvelope<DocumentVersionRestoredPayload> {
  return documentEvent(DOCUMENT_EVENT_TYPES.documentVersionRestored, context, documentId, {
    documentId,
    version,
    restoredFromVersion,
  });
}

/** A document template was created (document.template_created). */
export function documentTemplateCreatedEvent(
  context: DocumentEventContext,
  templateId: string,
  payload: DocumentTemplateCreatedPayload,
): EventEnvelope<DocumentTemplateCreatedPayload> {
  return documentEvent(DOCUMENT_EVENT_TYPES.documentTemplateCreated, context, templateId, payload);
}

/** A document template was archived (document.template_archived). */
export function documentTemplateArchivedEvent(
  context: DocumentEventContext,
  templateId: string,
): EventEnvelope<DocumentTemplateArchivedPayload> {
  return documentEvent(DOCUMENT_EVENT_TYPES.documentTemplateArchived, context, templateId, {
    templateId,
  });
}
