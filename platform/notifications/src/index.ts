/**
 * @nexora/module-notifications — platform module entry.
 *
 * The Notification platform (PSD.md §10): the deterministic policy, the
 * event consumer, the Notification/NotificationPreferences/ActivityItem
 * aggregates, the repository ports, the in-process stream seam, and the
 * application service (trusted read/query surface for the inbox,
 * preferences, and activity feed). Public contracts are exported here.
 */

// Domain
export * from './domain/notification.js';
export * from './domain/notification-preferences.js';
export * from './domain/activity-item.js';

// Events
export * from './events/index.js';

// Policy
export * from './policy/notification-policy.js';

// Repositories (ports)
export * from './repositories/notification-repository.js';

// Stream
export * from './stream/notification-stream.js';

// Consumer
export * from './consumer/notification-consumer.js';

// Application
export * from './application/notification-application-service.js';
