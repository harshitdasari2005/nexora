/**
 * @nexora/app-api — application event pipeline (shared).
 *
 * Builds the v1 event backbone: the notification consumer (notifications +
 * activity feed) rides the ProjectionChainPublisher so every domain event —
 * including MCP-originated writes — is projected into the activity/audit
 * read models exactly like HTTP-originated writes. Shared by `app.ts` and
 * the Nexora MCP server entry (S24 Phase 5: MCP never bypasses audit).
 *
 * The consumer is idempotent (one notification/activity per source event)
 * and never throws into the publisher — a projection failure cannot break
 * the business mutation that emitted the event.
 */

import type { EventPublisher } from '@nexora/shared/events';
import {
  NotificationEventConsumer,
  NotificationPolicy,
  NotificationStream,
} from '@nexora/module-notifications';

import type { RepositorySet } from '../container.js';
import { LoggingEventPublisher, type StructuredLogger } from './logging-event-publisher.js';
import { ProjectionChainPublisher } from './projection-chain-publisher.js';

/** A pino-style logger surface (satisfied by Fastify and adapters). */
export type PipelineLogger = StructuredLogger & {
  error(obj: Record<string, unknown>, message?: string): void;
};

/** Options of {@link buildApplicationEventPublisher}. */
export interface BuildApplicationEventPublisherOptions {
  /** The repository implementations (projection persistence ports). */
  repositories: RepositorySet;
  /** The base publisher (defaults to the structured-log publisher). */
  basePublisher?: EventPublisher;
  /** The structured logger (defaults to a silent logger). */
  logger?: PipelineLogger;
}

/** The composed event pipeline. */
export interface ApplicationEventPipeline {
  /** The publisher every application service emits through. */
  publisher: ProjectionChainPublisher;
  /** The real-time notification stream (SSE seam). */
  stream: NotificationStream;
}

/** A no-op structured logger (default; keeps the MCP stdio channel clean). */
const silentLogger: PipelineLogger = {
  info: () => undefined,
  error: () => undefined,
};

/**
 * Builds the application event pipeline: notification consumer → base
 * publisher, wrapped in the projection chain.
 */
export function buildApplicationEventPublisher(
  options: BuildApplicationEventPublisherOptions,
): ApplicationEventPipeline {
  const logger = options.logger ?? silentLogger;
  const basePublisher = options.basePublisher ?? new LoggingEventPublisher(logger);
  const stream = new NotificationStream();
  const consumer = new NotificationEventConsumer({
    policy: new NotificationPolicy(),
    notifications: options.repositories.notifications,
    preferences: options.repositories.notificationPreferences,
    activity: options.repositories.activity,
    publisher: basePublisher,
    stream,
    logger,
  });
  return {
    publisher: new ProjectionChainPublisher(basePublisher, [consumer]),
    stream,
  };
}
