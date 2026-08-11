/**
 * @nexora/domain-knowledge — domain events.
 *
 * The Knowledge bounded context event vocabulary (DOMAIN_MODEL.md §14
 * Knowledge: `KnowledgeUpdated`, `AnswerGenerated`). Knowledge is a
 * *Supporting* domain (DOMAIN_MODEL.md DOM-12), so knowledge events ride the
 * canonical `@nexora/shared/events` envelope with category `knowledge`.
 *
 * Events NEVER carry document content — they signal index lifecycle facts
 * (indexed / removed) for observability and downstream projections.
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { KnowledgeSourceId } from '../value-objects/knowledge-source-id.js';

/** Category applied to every Knowledge domain event (DOM-12 Supporting). */
export const KNOWLEDGE_EVENT_CATEGORY = 'knowledge' as const;

/** Stable event type names (EVT-* catalog, DOMAIN_MODEL.md §14). */
export const KNOWLEDGE_EVENT_TYPES = {
  knowledgeIndexed: 'knowledge.indexed',
  knowledgeRemoved: 'knowledge.removed',
} as const;

/** Payload of the {@link knowledgeIndexedEvent}. */
export interface KnowledgeIndexedPayload {
  /** The indexed source. */
  sourceId: KnowledgeSourceId;
  /** The source document id. */
  documentId: string;
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The indexed content version. */
  version: number;
}

/** Payload of the {@link knowledgeRemovedEvent}. */
export interface KnowledgeRemovedPayload {
  /** The removed source document id. */
  documentId: string;
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
}

/** Context required to emit a Knowledge domain event. */
export interface KnowledgeEventContext {
  /** The actor that caused the event. */
  actor: EventActor;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
}

/** Creates a typed Knowledge domain event envelope with canonical metadata. */
function knowledgeEvent<P>(
  type: string,
  context: KnowledgeEventContext,
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
      category: KNOWLEDGE_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** A document was indexed (knowledge.indexed — available for retrieval). */
export function knowledgeIndexedEvent(
  context: KnowledgeEventContext,
  payload: KnowledgeIndexedPayload,
): EventEnvelope<KnowledgeIndexedPayload> {
  return knowledgeEvent(KNOWLEDGE_EVENT_TYPES.knowledgeIndexed, context, payload);
}

/** A document left the index (knowledge.removed — archived/deleted). */
export function knowledgeRemovedEvent(
  context: KnowledgeEventContext,
  payload: KnowledgeRemovedPayload,
): EventEnvelope<KnowledgeRemovedPayload> {
  return knowledgeEvent(KNOWLEDGE_EVENT_TYPES.knowledgeRemoved, context, payload);
}
