/**
 * @nexora/ai-runtime — event envelope mapping.
 *
 * Bridges runtime events to the canonical platform event envelope
 * (`@nexora/shared/events`, SAD.md §11) at the boundary. The runtime stays
 * transport-agnostic; the publisher side translates here.
 */

import { createEventEnvelope, type EventEnvelope, type EventActor } from '@nexora/shared/events';
import type { RuntimeEvent } from './runtime-events.js';

/** Maps a runtime event's category and priority metadata. */
const EVENT_META: Record<
  RuntimeEvent['type'],
  { category: 'ai'; priority: 'normal' | 'high'; deliverySemantics: 'at_least_once' }
> = {
  'plan.created': { category: 'ai', priority: 'normal', deliverySemantics: 'at_least_once' },
  'plan.executed': { category: 'ai', priority: 'normal', deliverySemantics: 'at_least_once' },
  'tool.invoked': { category: 'ai', priority: 'normal', deliverySemantics: 'at_least_once' },
  'tool.succeeded': { category: 'ai', priority: 'normal', deliverySemantics: 'at_least_once' },
  'tool.failed': { category: 'ai', priority: 'high', deliverySemantics: 'at_least_once' },
  'response.generated': { category: 'ai', priority: 'normal', deliverySemantics: 'at_least_once' },
};

/** The metadata needed to map a runtime event to a canonical envelope. */
export interface EventEnvelopeContext {
  /** Tenant the event belongs to. */
  tenantId: string;
  /** Workspace the event belongs to, when workspace-scoped. */
  workspaceId?: string;
  /** The actor that caused the event. */
  actor: EventActor;
}

/** Maps a runtime event to a canonical {@link EventEnvelope}. */
export function toEventEnvelope(event: RuntimeEvent, context: EventEnvelopeContext): EventEnvelope {
  const meta = EVENT_META[event.type];
  const payload: Record<string, unknown> = { ...event };
  delete payload.type;
  delete payload.occurredAt;
  return createEventEnvelope({
    type: event.type,
    version: 1,
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    correlationId: event.runId,
    actor: context.actor,
    payload,
    metadata: {
      version: 1,
      category: meta.category,
      priority: meta.priority,
      deliverySemantics: meta.deliverySemantics,
    },
  });
}
