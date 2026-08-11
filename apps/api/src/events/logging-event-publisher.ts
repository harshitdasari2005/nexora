/**
 * @nexora/app-api — LoggingEventPublisher.
 *
 * The v1 {@link EventPublisher} implementation: domain events are emitted
 * into the structured application log with their envelope metadata. The
 * durable event bus / outbox (SAD.md §11) replaces this in Phase 2 without
 * touching the application or domain layers.
 */

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';

/** A minimal structured logger surface (satisfied by Fastify's logger). */
export interface StructuredLogger {
  info(obj: Record<string, unknown>, message?: string): void;
  error(obj: Record<string, unknown>, message?: string): void;
}

/** Publishes domain events to the structured log. */
export class LoggingEventPublisher implements EventPublisher {
  readonly #logger: StructuredLogger;

  constructor(logger: StructuredLogger) {
    this.#logger = logger;
  }

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    for (const event of events) {
      this.#logger.info(
        {
          eventId: event.id,
          eventType: event.type,
          version: event.version,
          tenantId: event.tenantId,
          workspaceId: event.workspaceId,
          correlationId: event.correlationId,
          actorKind: event.actor.kind,
          actorId: event.actor.id,
          category: event.metadata?.category,
        },
        'domain event published',
      );
    }
  }
}
