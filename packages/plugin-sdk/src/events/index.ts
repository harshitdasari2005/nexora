/**
 * @nexora/plugin-sdk — events.
 *
 * Event contributions: which platform events a plugin emits and subscribes
 * to (SAD.md §11 event-driven architecture). Event vocabulary is the
 * canonical `@nexora/contracts/events` envelope; the SDK defines the
 * subscription/handler contract.
 */

import type { PluginId } from '../types/index.js';

/** An event handler: receives the payload of a subscribed event type. */
export type EventHandler = (
  event: Readonly<Record<string, unknown>>,
  context: EventDispatchContext,
) => Promise<void> | void;

/** The context of an event dispatch. */
export interface EventDispatchContext {
  /** Tenant scope of the event. */
  tenantId: string;
  /** Workspace scope, when workspace-scoped. */
  workspaceId?: string;
  /** Correlation id of the originating workflow/conversation. */
  correlationId?: string;
  /** Whether delivery is async (fire-and-forget). */
  asyncDelivery: boolean;
}

/** A subscription: the plugin handles events of a given type. */
export interface EventSubscription {
  /** The event type subscribed to, e.g. `employee.created`. */
  eventType: string;
  /** The handler invoked on dispatch. */
  handler: EventHandler;
  /** Whether the handler must be awaited before the event is acked. */
  awaitable: boolean;
}

/** An event contribution. */
export interface EventContribution {
  /** Contribution kind discriminant. */
  kind: 'event';
  /** Event types the plugin emits. */
  emits: readonly string[];
  /** Event types the plugin subscribes to (with handlers). */
  subscriptions: readonly EventSubscription[];
  /** Owning plugin id. */
  pluginId?: PluginId;
}
