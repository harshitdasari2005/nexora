/**
 * @nexora/module-integrations — domain errors.
 *
 * Expected failure values of the integration surface. Every error extends the
 * shared `NexoraError` hierarchy so codes stay canonical (API_CONTRACTS.md
 * §10) and the API maps them consistently with every other module.
 */

import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@nexora/shared/errors';

/** The webhook endpoint does not exist in the requested scope. */
export class WebhookEndpointNotFoundError extends NotFoundError {
  constructor(input: { endpointId: string; workspaceId?: string }) {
    super(
      `Webhook endpoint "${input.endpointId}" was not found${
        input.workspaceId === undefined ? '' : ` in workspace "${input.workspaceId}"`
      }`,
    );
  }
}

/** The webhook endpoint URL is not a valid HTTP(S) endpoint. */
export class InvalidWebhookUrlError extends ValidationError {
  constructor(input: { url: string }) {
    super(`Invalid webhook URL "${input.url}" — must be an http(s) endpoint`, []);
  }
}

/** The event types are not in the subscribable catalog. */
export class UnsubscribableEventError extends ValidationError {
  constructor(input: { eventTypes: readonly string[] }) {
    super(`Unsubscribable event type(s): ${input.eventTypes.join(', ')}`, []);
  }
}

/** The webhook endpoint is already archived and rejects mutations. */
export class WebhookEndpointArchivedError extends ConflictError {
  constructor(input: { endpointId: string }) {
    super(`Webhook endpoint "${input.endpointId}" is archived`);
  }
}

/** The webhook signing secret could not be rotated on an archived endpoint. */
export class WebhookSecretRotationError extends ConflictError {
  constructor(input: { endpointId: string }) {
    super(`Cannot rotate the secret of archived webhook endpoint "${input.endpointId}"`);
  }
}

/** The inbound email sender is not allowlisted for this workspace. */
export class InboundSenderNotAllowedError extends AuthorizationError {
  constructor(input: { from: string }) {
    super(`Inbound email sender "${input.from}" is not allowlisted for this workspace`);
  }
}

/** The inbound email action references an unknown target. */
export class InboundActionTargetNotFoundError extends NotFoundError {
  constructor(input: { action: string; targetId: string }) {
    super(`Inbound email action "${input.action}" target "${input.targetId}" was not found`);
  }
}

/** The inbound email signature could not be verified. */
export class InboundSignatureInvalidError extends AuthorizationError {
  constructor() {
    super('Inbound email signature verification failed');
  }
}

/** The inbound email action is not part of the supported action catalog. */
export class UnknownInboundActionError extends ValidationError {
  constructor(input: { action: string }) {
    super(`Unknown inbound email action "${input.action}"`, []);
  }
}
