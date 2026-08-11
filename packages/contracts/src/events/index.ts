/**
 * @nexora/contracts — event contracts.
 *
 * The canonical event envelope and the EVT-* catalog shape (PRODUCT_SPEC.md
 * §4, SAD.md §11). Event publishers construct envelopes with
 * `createEventEnvelope` (from `@nexora/shared/events`) and type the payload
 * with these contracts.
 *
 * Literal-union contracts (`EventCategory`, `EventPriority`,
 * `EventDeliverySemantics`) declare their constant arrays here so the
 * package stays dependency-free; the guards module provides runtime checks.
 */

import type { CorrelationId, TenantId, Timestamp, WorkspaceId } from '../common/index.js';

/**
 * The actor that caused an event (PERSISTENCE.md §13 audit storage).
 * `system` covers unattended platform activity (passive session expiry,
 * scheduled maintenance) so audit trails never attribute it to a user or
 * agent that did not act.
 */
export interface EventActor {
  /** Actor kind: a human user, an AI agent execution, or the platform. */
  kind: 'user' | 'agent' | 'system';
  /** Actor id (user id, agent id, or stable system-actor id). */
  id: string;
}

/** Event category — coarse grouping used for routing and observability. */
export const EVENT_CATEGORIES = [
  'identity',
  'hr',
  'projects',
  'crm',
  'finance',
  'sales',
  'inventory',
  'procurement',
  'documents',
  'knowledge',
  'workflow',
  'approval',
  'calendar',
  'notification',
  'ai',
  'platform',
  'plugin',
] as const;

/** Single event category literal. */
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** Event priority — drives delivery ordering and DLQ handling (SAD.md §11.4). */
export const EVENT_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;

/** Single event priority literal. */
export type EventPriority = (typeof EVENT_PRIORITIES)[number];

/**
 * Delivery semantics promised by the event bus for an event type
 * (SAD.md §11.3).
 */
export const EVENT_DELIVERY_SEMANTICS = ['at_least_once', 'exactly_once', 'best_effort'] as const;

/** Single delivery-semantics literal. */
export type EventDeliverySemantics = (typeof EVENT_DELIVERY_SEMANTICS)[number];

/**
 * Metadata carried by every event beyond the payload — versioning,
 * categorization, and routing (SAD.md §11.5 event versioning).
 */
export interface EventMetadata {
  /** Event schema version for versioned evolution (SAD.md §11.5). */
  version: number;
  /** Coarse category used for routing and observability. */
  category: EventCategory;
  /** Delivery priority. */
  priority: EventPriority;
  /** Delivery semantics promised by the publisher. */
  deliverySemantics: EventDeliverySemantics;
}

/**
 * Event versioning contract: events with the same `type` may evolve
 * (SAD.md §11.5); the envelope carries the full version identity so
 * consumers can plan migrations (see the versioning module).
 */
export interface EventVersion {
  /** The event type, e.g. `employee.created`. */
  type: string;
  /** The schema version of this event. */
  version: number;
}

/**
 * The transport-neutral event envelope. `type` must match a catalog entry
 * (EVT-*, PRODUCT_SPEC.md §4) or a declared plugin extension.
 *
 * Note: a structurally identical envelope exists in `@nexora/shared/events`
 * (runtime factory). Keep both in sync — the shared envelope carries the
 * runtime `createEventEnvelope`; this one is the canonical contract.
 */
export interface EventEnvelope<TType extends string = string, TPayload = unknown> {
  /** Unique event id (`evt_...`). */
  id: string;
  /** Stable event type, e.g. `employee.created`. */
  type: TType;
  /** Event schema version for versioned evolution (SAD.md §11.5). */
  version: number;
  /** ISO-8601 UTC time the event occurred. */
  occurredAt: Timestamp;
  /** Tenant the event belongs to. */
  tenantId: TenantId;
  /** Workspace the event belongs to, when applicable. */
  workspaceId?: WorkspaceId;
  /** Correlation id of the originating execution. */
  correlationId: CorrelationId;
  /** Optional parent event id for event chains. */
  parentEventId?: string;
  /** The actor that caused the event. */
  actor: EventActor;
  /**
   * Event metadata: category, priority, delivery semantics. Optional so the
   * envelope stays structurally compatible with the runtime factory in
   * `@nexora/shared/events`; publishers that provide metadata make it
   * mandatory at emission time.
   */
  metadata?: EventMetadata;
  /** Event payload, typed by the concrete event. */
  payload: TPayload;
}

/**
 * A subscription to a set of event types (BKD.md §7 subscribe).
 */
export interface EventSubscription {
  /** Id of the subscription. */
  id: string;
  /** Event types subscribed to (`*` matches all). */
  eventTypes: readonly string[];
  /** Consumer group id for load-balanced consumption. */
  groupId: string;
}

/**
 * Delivery state of a single event to a consumer (for observability and DLQ
 * handling — SAD.md §11.4).
 */
export interface EventDeliveryStatus {
  /** Id of the event delivered. */
  eventId: string;
  /** Consumer that processed it. */
  consumer: string;
  /** Delivery state. */
  state: 'delivered' | 'retrying' | 'dead_lettered';
  /** Number of delivery attempts so far. */
  attempts: number;
  /** ISO-8601 UTC time of the last attempt. */
  lastAttemptAt: Timestamp;
}
