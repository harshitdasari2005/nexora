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
  articleCreated: 'knowledge.article.created',
  articleUpdated: 'knowledge.article.updated',
  articlePublished: 'knowledge.article.published',
  articleArchived: 'knowledge.article.archived',
  categoryCreated: 'knowledge.category.created',
  categoryArchived: 'knowledge.category.archived',
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

/** Payload of the {@link articleCreatedEvent}. */
export interface KnowledgeArticleCreatedPayload {
  /** The created article. */
  articleId: string;
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The article title at creation. */
  title: string;
  /** The initial status (`draft` — never indexed). */
  status: string;
}

/** Payload of the {@link articleUpdatedEvent}. */
export interface KnowledgeArticleUpdatedPayload {
  /** The updated article. */
  articleId: string;
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The article title. */
  title: string;
  /** The lifecycle status after the update. */
  status: string;
  /** The new monotonic content version. */
  version: number;
}

/** Payload of the {@link articlePublishedEvent}. */
export interface KnowledgeArticlePublishedPayload {
  /** The published article. */
  articleId: string;
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The content version that becomes retrievable. */
  version: number;
}

/** Payload of the {@link articleArchivedEvent}. */
export interface KnowledgeArticleArchivedPayload {
  /** The archived article. */
  articleId: string;
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
}

/** Payload of the {@link categoryCreatedEvent}. */
export interface KnowledgeCategoryCreatedPayload {
  /** The created category. */
  categoryId: string;
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The category name. */
  name: string;
  /** The initial status (`active`). */
  status: string;
}

/** Payload of the {@link categoryArchivedEvent}. */
export interface KnowledgeCategoryArchivedPayload {
  /** The archived category. */
  categoryId: string;
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

/** An article was created as a draft (knowledge.article.created). */
export function articleCreatedEvent(
  context: KnowledgeEventContext,
  payload: KnowledgeArticleCreatedPayload,
): EventEnvelope<KnowledgeArticleCreatedPayload> {
  return knowledgeEvent(KNOWLEDGE_EVENT_TYPES.articleCreated, context, payload);
}

/** An article's content was updated (knowledge.article.updated). */
export function articleUpdatedEvent(
  context: KnowledgeEventContext,
  payload: KnowledgeArticleUpdatedPayload,
): EventEnvelope<KnowledgeArticleUpdatedPayload> {
  return knowledgeEvent(KNOWLEDGE_EVENT_TYPES.articleUpdated, context, payload);
}

/** An article was published (knowledge.article.published — retrievable now). */
export function articlePublishedEvent(
  context: KnowledgeEventContext,
  payload: KnowledgeArticlePublishedPayload,
): EventEnvelope<KnowledgeArticlePublishedPayload> {
  return knowledgeEvent(KNOWLEDGE_EVENT_TYPES.articlePublished, context, payload);
}

/** An article was archived (knowledge.article.archived — leaves the index). */
export function articleArchivedEvent(
  context: KnowledgeEventContext,
  payload: KnowledgeArticleArchivedPayload,
): EventEnvelope<KnowledgeArticleArchivedPayload> {
  return knowledgeEvent(KNOWLEDGE_EVENT_TYPES.articleArchived, context, payload);
}

/** A category was created (knowledge.category.created). */
export function categoryCreatedEvent(
  context: KnowledgeEventContext,
  payload: KnowledgeCategoryCreatedPayload,
): EventEnvelope<KnowledgeCategoryCreatedPayload> {
  return knowledgeEvent(KNOWLEDGE_EVENT_TYPES.categoryCreated, context, payload);
}

/** A category was archived (knowledge.category.archived). */
export function categoryArchivedEvent(
  context: KnowledgeEventContext,
  payload: KnowledgeCategoryArchivedPayload,
): EventEnvelope<KnowledgeCategoryArchivedPayload> {
  return knowledgeEvent(KNOWLEDGE_EVENT_TYPES.categoryArchived, context, payload);
}
