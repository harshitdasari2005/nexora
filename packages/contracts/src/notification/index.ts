/**
 * @nexora/contracts — notification contracts.
 *
 * The Notification platform contracts (PSD.md §10): notification records,
 * channels, targets, priorities, and statuses. Consumers render
 * notifications; the platform routes them (Notification Platform, SAD.md
 * §5.4).
 */

import type { Timestamp } from '../common/index.js';

/** Notification channels supported by the Notification platform. */
export const NOTIFICATION_CHANNELS = ['inbox', 'email', 'push', 'slack', 'sms', 'webhook'] as const;

/** Single notification channel literal. */
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Notification priorities (PSD.md §10 notification UX). */
export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

/** Single notification priority literal. */
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

/** Delivery state of a notification per target/channel. */
export const NOTIFICATION_STATUSES = [
  'queued',
  'delivered',
  'read',
  'failed',
  'suppressed',
] as const;

/** Single notification status literal. */
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/**
 * A notification target: a user, a role (all users with the role), or a
 * workspace. The id is the target's own identifier namespace — user ids,
 * role names, and workspace ids are each strings within their kind, so the
 * kind field discriminates, not the id type.
 */
export interface NotificationTarget {
  /** Target kind. */
  kind: 'user' | 'role' | 'workspace';
  /** Target id (user id, role name, or workspace id). */
  id: string;
}

/**
 * A single notification record (PSD.md §10). `payload` carries the
 * structured data rendered by each channel.
 */
export interface Notification {
  /** Notification id. */
  id: string;
  /** Notification type, e.g. `approval.requested`. */
  type: string;
  /** Targets the notification is addressed to. */
  targets: readonly NotificationTarget[];
  /** Channels the notification is delivered over. */
  channels: readonly NotificationChannel[];
  /** Notification priority. */
  priority: NotificationPriority;
  /** Human-readable subject. */
  subject: string;
  /** Structured payload for channel rendering. */
  payload: Record<string, unknown>;
  /** ISO-8601 UTC time the notification was created. */
  createdAt: Timestamp;
  /** Delivery status per channel (observability). */
  status: Readonly<Record<NotificationChannel, NotificationStatus>>;
}

/**
 * Per-user notification preferences (PSD.md §10 notification UX).
 * Categories gate presentation/delivery only — disabling a category never
 * disables the underlying business action; defaults are safe (all enabled).
 */
export interface NotificationPreferences {
  /** The owning user. */
  userId: string;
  /** The tenant (organization) scope. */
  tenantId: string;
  /**
   * Category → enabled map. Categories are notification types grouped by
   * business area (`workflow`, `approval`, `project`, `employee`,
   * `document`, `knowledge`). A missing entry means enabled.
   */
  categories: Record<string, boolean>;
  /** ISO-8601 UTC time the preferences were last updated. */
  updatedAt: Timestamp;
}
