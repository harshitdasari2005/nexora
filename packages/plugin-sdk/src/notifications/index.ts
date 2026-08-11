/**
 * @nexora/plugin-sdk — notifications.
 *
 * Notification contributions: how a plugin sends notifications through the
 * Notification platform (SAD.md §5.4). The canonical `Notification`
 * contract from `@nexora/contracts/notification` is reused; providers render
 * and deliver notifications.
 */

import type { Notification, NotificationChannel } from '@nexora/contracts/notification';
import type { PluginId } from '../types/index.js';

/** A notification provider: delivers notifications over one or more channels. */
export interface NotificationProvider {
  /** The provider name, for observability. */
  readonly name: string;
  /** The channels this provider delivers over. */
  readonly channels: readonly NotificationChannel[];
  /** Delivers a notification; throws on unrecoverable delivery failure. */
  send(notification: Notification): Promise<void>;
}

/** A notification contribution: registers the provider with the platform. */
export interface NotificationContribution {
  /** Contribution kind discriminant. */
  kind: 'notification';
  /** The notification provider. */
  provider: NotificationProvider;
  /** Notification types the plugin sends. */
  notificationTypes: readonly string[];
  /** Owning plugin id. */
  pluginId?: PluginId;
}
