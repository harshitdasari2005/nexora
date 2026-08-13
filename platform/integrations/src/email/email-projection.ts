/**
 * @nexora/module-integrations — EmailProjection.
 *
 * The email channel of the notification seam. Sits on the canonical event
 * stream next to the Notification consumer and uses the SAME deterministic
 * policy (a {@link NotificationPolicy}): for every event the policy wants a
 * recipient-scoped notification, the projection resolves the recipient's
 * email from the trusted identity read and dispatches it through the
 * outbox ({@link IntegrationApplicationService.dispatchEmail}).
 *
 * Security and reliability contract:
 * - Recipients/emails come ONLY from the trusted event actor + identity
 *   read — never from payload fields, the model, or the client.
 * - Subject/body are the policy's deterministic text (never raw blobs).
 * - Idempotent on the source event: a duplicate delivery can never
 *   double-send (outbox unique index).
 * - The projection NEVER throws into the publisher: an email failure is
 *   logged and swallowed so the business mutation is never broken.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { NotificationPolicy } from '@nexora/module-notifications';

import type { IntegrationApplicationService } from '../application/integration-application-service.js';

/** A minimal structured logger surface (satisfied by Fastify's logger). */
export interface EmailProjectionLogger {
  error(obj: Record<string, unknown>, message?: string): void;
}

/** Resolves a trusted user email (identity read port, composition root). */
export interface UserEmailResolver {
  findEmailByUserId(userId: string): Promise<string | undefined>;
}

/** Dependencies of the {@link EmailProjection}. */
export interface EmailProjectionDependencies {
  /** The deterministic notification policy (shared with the Notification consumer). */
  policy: NotificationPolicy;
  /** The application service that persists the outbox and transports. */
  service: IntegrationApplicationService;
  /** Trusted identity read (recipient email resolution). */
  userEmails: UserEmailResolver;
  /** An optional logger (failures never propagate to the publisher). */
  logger?: EmailProjectionLogger;
}

/**
 * Consumes the canonical business event stream and dispatches emails for
 * recipient-scoped policy outcomes. Attached to the EventPublisher seam at
 * the composition root.
 */
export class EmailProjection {
  readonly #policy: NotificationPolicy;
  readonly #service: IntegrationApplicationService;
  readonly #userEmails: UserEmailResolver;
  readonly #logger?: EmailProjectionLogger;

  constructor(dependencies: EmailProjectionDependencies) {
    this.#policy = dependencies.policy;
    this.#service = dependencies.service;
    this.#userEmails = dependencies.userEmails;
    this.#logger = dependencies.logger;
  }

  /** Projects one event envelope into outbox records. Never throws. */
  async handle(event: EventEnvelope): Promise<void> {
    try {
      const outcome = this.#policy.evaluate(event);
      for (const spec of outcome.notifications) {
        const email = await this.#userEmails.findEmailByUserId(spec.recipientId);
        if (email === undefined) {
          continue; // No trusted email — no email dispatch (in-app still works).
        }
        await this.#service.dispatchEmail({
          tenantId: event.tenantId as TenantId,
          workspaceId: (spec.workspaceId as WorkspaceId) ?? undefined,
          recipientId: spec.recipientId,
          recipientEmail: email,
          subject: spec.title,
          body: spec.body,
          sourceEventId: event.id,
          correlationId: event.correlationId,
        });
      }
    } catch (caught) {
      this.#logger?.error(
        { err: caught, eventId: event.id, eventType: event.type },
        'email projection failed',
      );
    }
  }
}
