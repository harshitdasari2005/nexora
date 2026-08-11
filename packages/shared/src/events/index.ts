/**
 * @nexora/shared — event base types.
 *
 * The transport-neutral envelope every platform event rides in. Domain events
 * (EVT-* catalog, PRODUCT_SPEC.md §4) carry a typed `payload` plus this
 * envelope's metadata (id, type, version, correlation, tenant/workspace,
 * actor). The platform event-bus (SAD.md §11, BKD.md §7) consumes this shape.
 */

import { prefixedId } from '../ids/index.js';
import type { IsoTimestamp } from '../time/index.js';

/** Event metadata vocabulary, mirroring `@nexora/contracts/events`. */
interface EventMetadata {
  /** Event schema version. */
  version: number;
  /** Coarse category used for routing and observability. */
  category:
    | 'identity'
    | 'hr'
    | 'projects'
    | 'crm'
    | 'finance'
    | 'sales'
    | 'inventory'
    | 'procurement'
    | 'documents'
    | 'knowledge'
    | 'workflow'
    | 'approval'
    | 'calendar'
    | 'notification'
    | 'ai'
    | 'platform'
    | 'plugin';
  /** Delivery priority. */
  priority: 'low' | 'normal' | 'high' | 'critical';
  /** Delivery semantics promised by the publisher. */
  deliverySemantics: 'at_least_once' | 'exactly_once' | 'best_effort';
}

/**
 * The actor that caused an event. `kind` discriminates humans, AI
 * executions, and unattended system activity so audit trails can always
 * attribute the true source (PERSISTENCE.md §13 audit storage): passive
 * expiry, scheduled maintenance, and platform-side transitions are
 * `system`, never attributed to a user or agent that did not act.
 */
export interface EventActor {
  /** Actor kind: a human user, an AI agent execution, or the platform. */
  kind: 'user' | 'agent' | 'system';
  /** Actor id (user id, agent id, or stable system-actor id). */
  id: string;
}

/**
 * Base event envelope metadata. `payload` is generic and constrained by the
 * concrete event definition.
 *
 * Note: a structurally compatible contract exists in `@nexora/contracts/events`
 * (canonical); keep both in sync. This one carries the runtime factory
 * ({@link createEventEnvelope}); contracts is the canonical type surface.
 */
export interface EventEnvelope<P = unknown> {
  /** Unique event id (uuid). */
  id: string;
  /** Stable event type name, e.g. `employee.created` (EVT-* catalog). */
  type: string;
  /** Event schema version, for versioned evolution (SAD.md §11.5). */
  version: number;
  /** ISO-8601 UTC time the event occurred. */
  occurredAt: IsoTimestamp;
  /** Tenant (company) the event belongs to; never null in production. */
  tenantId: string;
  /** Workspace the event belongs to, when applicable. */
  workspaceId?: string;
  /** Correlation id tying this event to its originating execution. */
  correlationId: string;
  /** Optional parent event id for event chains. */
  parentEventId?: string;
  /** The actor that caused the event. */
  actor: EventActor;
  /** Event payload, typed by the concrete event. */
  payload: P;
  /**
   * Event metadata: category, priority, delivery semantics. Populated by
   * {@link createEventEnvelope} with sensible defaults when not supplied, so
   * every emitted event honors the canonical vocabulary contract
   * (`@nexora/contracts/events`).
   */
  metadata?: EventMetadata;
}

/**
 * Creates an event envelope, filling in `id`, `occurredAt`, and `version`
 * when not provided by the caller. Used by event publishers so envelope
 * consistency is enforced in one place.
 */
export function createEventEnvelope<P>(
  input: Omit<EventEnvelope<P>, 'id' | 'occurredAt' | 'metadata'> &
    Partial<Pick<EventEnvelope<P>, 'id' | 'occurredAt' | 'metadata'>>,
): EventEnvelope<P> {
  return {
    ...input,
    id: input.id ?? randomEventId(),
    version: input.version ?? 1,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    metadata: input.metadata ?? {
      version: input.version ?? 1,
      category: 'platform',
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  };
}

/** Generates a unique event id with the `evt_` prefix. */
export function randomEventId(): string {
  return prefixedId('evt');
}

/**
 * The event publishing port (SAD.md §11 event bus). Domain and application
 * layers depend on this contract; the infrastructure layer provides an
 * implementation (e.g. an outbox table or a message-broker publisher).
 * Delivery is at-least-once: consumers must be idempotent.
 */
export interface EventPublisher {
  /** Publishes a batch of domain event envelopes (at-least-once). */
  publish(events: readonly EventEnvelope[]): Promise<void>;
}
