/**
 * @nexora/module-notifications — notification stream.
 *
 * A minimal in-process subscription seam for real-time notification updates.
 * The SSE route subscribes per authenticated connection and the notification
 * consumer publishes created notifications/activity onto the stream; each
 * route filters server-side by the authenticated recipient before writing to
 * the wire. This is a transport SEAM (no messaging protocol is introduced) —
 * a durable bus can replace it without touching the consumer or the routes.
 */

import type { ActivityItem } from '../domain/activity-item.js';
import type { Notification } from '../domain/notification.js';

/** An event pushed to the stream. */
export type NotificationStreamEvent =
  { kind: 'notification'; notification: Notification } | { kind: 'activity'; item: ActivityItem };

/** A subscriber callback (returns an unsubscribe function). */
export type NotificationStreamListener = (event: NotificationStreamEvent) => void;

/**
 * The in-process {@link NotificationStream}. Subscribe/unsubscribe semantics
 * keep the SSE route clean; `publish` is called by the notification
 * consumer when a notification or activity item is created.
 */
export class NotificationStream {
  readonly #listeners = new Set<NotificationStreamListener>();

  /** Subscribes a listener; returns an unsubscribe function. */
  subscribe(listener: NotificationStreamListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Publishes an event to all subscribers (best-effort, never throws). */
  publish(event: NotificationStreamEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // A subscriber must never break the notification pipeline.
      }
    }
  }
}
