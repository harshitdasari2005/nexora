/**
 * @nexora/app-api — NotificationForwardingPublisher.
 *
 * The v1 "event backbone" seam for the Notification platform: every domain
 * event published by any application service flows through this publisher,
 * which first hands the envelope to the {@link NotificationEventConsumer}
 * (the projection layer) and then to the base publisher (e.g. the
 * structured-log publisher). This preserves the architecture:
 *
 *   Domain → EventEnvelope → Publisher seam → Notification Consumer
 *
 * without introducing a second event bus. The consumer is guaranteed not to
 * throw (it logs and swallows projection failures), so the business mutation
 * that emitted the event is never broken by notification delivery.
 */

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import type { NotificationEventConsumer } from '@nexora/module-notifications';

/** A publisher that forwards every event to the notification consumer first. */
export class NotificationForwardingPublisher implements EventPublisher {
  readonly #base: EventPublisher;
  readonly #consumer: NotificationEventConsumer;

  constructor(base: EventPublisher, consumer: NotificationEventConsumer) {
    this.#base = base;
    this.#consumer = consumer;
  }

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    // Project first: notifications/activity are a projection of the same
    // event stream. The consumer never throws (failures are logged).
    for (const event of events) {
      await this.#consumer.handle(event);
    }
    // Then the base publisher (logging/durable bus in later phases).
    await this.#base.publish(events);
  }
}
