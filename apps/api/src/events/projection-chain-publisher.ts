/**
 * @nexora/app-api — ProjectionChainPublisher.
 *
 * The v1 event backbone seam for ALL projections on the canonical event
 * stream. Every domain event published by any application service flows
 * through this publisher, which hands the envelope to each projection
 * consumer (in order) and then to the base publisher. This preserves the
 * architecture:
 *
 *   Domain → EventEnvelope → Publisher seam → Projection consumers
 *                                              ├─ WebhookDispatcher (S20)
 *                                              ├─ EmailProjection (S20)
 *                                              └─ NotificationEventConsumer
 *
 * Projections are guaranteed not to throw (each logs and swallows its own
 * failures), so the business mutation that emitted the event is never
 * broken by any projection.
 */

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';

/** A projection that consumes one event envelope (never throws). */
export interface EventProjection {
  handle(event: EventEnvelope): Promise<void>;
}

/** A publisher that forwards every event to the projections first. */
export class ProjectionChainPublisher implements EventPublisher {
  readonly #base: EventPublisher;
  readonly #projections: EventProjection[] = [];

  constructor(base: EventPublisher, projections: readonly EventProjection[] = []) {
    this.#base = base;
    this.#projections.push(...projections);
  }

  /**
   * Appends projections (composition order). Used when a projection needs a
   * dependency that is itself composed later (e.g. the S20 dispatcher needs
   * the AI runtime's ApprovalEngine for inbound actions). Events published
   * before registration are not retroactively projected — composition runs
   * before any event is published.
   */
  addProjections(projections: readonly EventProjection[]): void {
    this.#projections.push(...projections);
  }

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    for (const event of events) {
      for (const projection of this.#projections) {
        await projection.handle(event);
      }
    }
    await this.#base.publish(events);
  }
}
