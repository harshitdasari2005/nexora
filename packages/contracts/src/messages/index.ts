/**
 * @nexora/contracts — message contracts.
 *
 * The generic message vocabulary for async communication (queues, event
 * delivery, notification routing). Channels, priorities, and statuses are
 * owned by the Notification contracts (`@nexora/contracts/notification`) —
 * this module builds on them rather than re-declaring them.
 */

import type {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  NotificationTarget,
} from '../notification/index.js';
import type { CorrelationId, Timestamp } from '../common/index.js';

/**
 * A message envelope for async transport (SAD.md §11 event bus / BKD.md §7
 * queues). Notifications are a specialization addressed through the
 * Notification platform.
 */
export interface MessageEnvelope {
  /** Unique message id. */
  id: string;
  /** Message type, e.g. `notification.send`. */
  type: string;
  /** Correlation id tying the message to its originating execution. */
  correlationId: CorrelationId;
  /** Targets the message is addressed to. */
  targets: readonly NotificationTarget[];
  /** Channels eligible for delivery. */
  channels: readonly NotificationChannel[];
  /** Delivery priority. */
  priority: NotificationPriority;
  /** Structured payload. */
  payload: Record<string, unknown>;
  /** ISO-8601 UTC time the message was created. */
  createdAt: Timestamp;
  /** Delivery status per channel. */
  status: Readonly<Record<NotificationChannel, NotificationStatus>>;
}
