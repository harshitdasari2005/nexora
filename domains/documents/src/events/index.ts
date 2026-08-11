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

/** Context required to emit a Documents domain event. */
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
  documentId: DocumentId,
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
