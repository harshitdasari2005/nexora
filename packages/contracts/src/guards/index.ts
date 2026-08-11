/**
 * @nexora/contracts — runtime guards.
 *
 * Pure, dependency-free type guards for the literal-union contracts. These
 * let consumers validate untrusted input (API payloads, plugin manifests,
 * event headers) against the canonical contract vocabulary at runtime while
 * keeping the package dependency-free.
 */

import {
  EVENT_CATEGORIES,
  EVENT_DELIVERY_SEMANTICS,
  EVENT_PRIORITIES,
  type EventCategory,
  type EventDeliverySemantics,
  type EventPriority,
} from '../events/index.js';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_STATUSES,
  type NotificationChannel,
  type NotificationPriority,
  type NotificationStatus,
} from '../notification/index.js';
import { PLUGIN_LIFECYCLE_STATES, type PluginLifecycleState } from '../plugin/index.js';
import { REGISTRY_TYPES, type RegistryType } from '../registry/index.js';
import { COMPATIBILITY_LEVELS, type CompatibilityLevel } from '../versioning/index.js';

const EVENT_CATEGORY_SET = new Set<string>(EVENT_CATEGORIES);
const EVENT_PRIORITY_SET = new Set<string>(EVENT_PRIORITIES);
const EVENT_SEMANTICS_SET = new Set<string>(EVENT_DELIVERY_SEMANTICS);
const CHANNEL_SET = new Set<string>(NOTIFICATION_CHANNELS);
const PRIORITY_SET = new Set<string>(NOTIFICATION_PRIORITIES);
const STATUS_SET = new Set<string>(NOTIFICATION_STATUSES);
const LIFECYCLE_SET = new Set<string>(PLUGIN_LIFECYCLE_STATES);
const REGISTRY_SET = new Set<string>(REGISTRY_TYPES);
const COMPATIBILITY_SET = new Set<string>(COMPATIBILITY_LEVELS);

/** True when the value is a canonical {@link EventCategory}. */
export function isEventCategory(value: unknown): value is EventCategory {
  return typeof value === 'string' && EVENT_CATEGORY_SET.has(value);
}

/** True when the value is a canonical {@link EventPriority}. */
export function isEventPriority(value: unknown): value is EventPriority {
  return typeof value === 'string' && EVENT_PRIORITY_SET.has(value);
}

/** True when the value is a canonical {@link EventDeliverySemantics}. */
export function isEventDeliverySemantics(value: unknown): value is EventDeliverySemantics {
  return typeof value === 'string' && EVENT_SEMANTICS_SET.has(value);
}

/** True when the value is a canonical {@link NotificationChannel}. */
export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === 'string' && CHANNEL_SET.has(value);
}

/** True when the value is a canonical {@link NotificationPriority}. */
export function isNotificationPriority(value: unknown): value is NotificationPriority {
  return typeof value === 'string' && PRIORITY_SET.has(value);
}

/** True when the value is a canonical {@link NotificationStatus}. */
export function isNotificationStatus(value: unknown): value is NotificationStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

/** True when the value is a canonical {@link PluginLifecycleState}. */
export function isPluginLifecycleState(value: unknown): value is PluginLifecycleState {
  return typeof value === 'string' && LIFECYCLE_SET.has(value);
}

/** True when the value is a canonical {@link RegistryType}. */
export function isRegistryType(value: unknown): value is RegistryType {
  return typeof value === 'string' && REGISTRY_SET.has(value);
}

/** True when the value is a canonical {@link CompatibilityLevel}. */
export function isCompatibilityLevel(value: unknown): value is CompatibilityLevel {
  return typeof value === 'string' && COMPATIBILITY_SET.has(value);
}

/** True when the value looks like a semantic version (`x.y.z`). */
export function isSemVer(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
}

/**
 * Validates the envelope-level fields of an event payload against the
 * canonical contracts. Returns a human-readable error message, or `null`
 * when valid. Envelope `id`/`occurredAt` formats are validated by the
 * runtime bus; this checks vocabulary only.
 */
export function validateEventEnvelope(envelope: {
  type: unknown;
  version: unknown;
  metadata?: { category?: unknown; priority?: unknown; deliverySemantics?: unknown };
}): string | null {
  if (typeof envelope.type !== 'string' || envelope.type.length === 0) {
    return 'event.type must be a non-empty string';
  }
  if (
    typeof envelope.version !== 'number' ||
    !Number.isInteger(envelope.version) ||
    envelope.version < 1
  ) {
    return 'event.version must be a positive integer';
  }
  const metadata = envelope.metadata;
  if (metadata === undefined) {
    return null;
  }
  if (metadata.category !== undefined && !isEventCategory(metadata.category)) {
    return `event.metadata.category is not a canonical category: ${String(metadata.category)}`;
  }
  if (metadata.priority !== undefined && !isEventPriority(metadata.priority)) {
    return `event.metadata.priority is not a canonical priority: ${String(metadata.priority)}`;
  }
  if (
    metadata.deliverySemantics !== undefined &&
    !isEventDeliverySemantics(metadata.deliverySemantics)
  ) {
    return `event.metadata.deliverySemantics is not canonical: ${String(metadata.deliverySemantics)}`;
  }
  return null;
}
