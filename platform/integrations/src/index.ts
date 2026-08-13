/**
 * @nexora/module-integrations — public surface.
 *
 * The Integrations module (S20): webhooks out with signed deliveries +
 * delivery receipts, the email channel (outbox + dev sink), and inbound
 * email actions routed through the governing execution paths. This barrel
 * is the only import surface — consumers never reach into subfolders.
 */

export {
  IntegrationApplicationService,
  type InboundEmailRouting,
  type IntegrationApplicationServiceDependencies,
} from './application/integration-application-service.js';
export {
  EmailRecord,
  type CreateEmailRecordInput,
  type EmailRecordSnapshot,
  type EmailRecordStatus,
} from './domain/email-record.js';
export {
  WebhookDelivery,
  type CreateWebhookDeliveryInput,
  type WebhookDeliverySnapshot,
  type WebhookDeliveryStatus,
} from './domain/webhook-delivery.js';
export {
  WebhookEndpoint,
  WEBHOOK_SUBSCRIBABLE_EVENTS,
  type CreateWebhookEndpointInput,
  type WebhookEndpointSnapshot,
} from './domain/webhook-endpoint.js';
export { DevEmailSink, EmailSendError, type EmailSender } from './email/email-sender.js';
export {
  DuplicateInboundMessageError,
  InboundActionTargetNotFoundError,
  InboundSenderNotAllowedError,
  InboundSignatureInvalidError,
  InvalidWebhookUrlError,
  UnsubscribableEventError,
  UnknownInboundActionError,
  WebhookEndpointArchivedError,
  WebhookEndpointNotFoundError,
  WebhookSecretRotationError,
} from './errors/index.js';
export {
  EmailProjection,
  type EmailProjectionDependencies,
  type EmailProjectionLogger,
  type UserEmailResolver,
} from './email/email-projection.js';
export {
  WebhookDispatcher,
  fetchWebhookHttpClient,
  type WebhookDispatcherDependencies,
  type WebhookDispatcherLogger,
  type WebhookHttpClient,
} from './dispatch/webhook-dispatcher.js';
export {
  INTEGRATION_EVENT_TYPES,
  type EmailDispatchedEventPayload,
  type InboundEmailEventPayload,
  type IntegrationEventContext,
  type IntegrationEventType,
  type WebhookDeliveryEventPayload,
  type WebhookEndpointEventPayload,
} from './events/index.js';
export type {
  EmailOutboxRepository,
  InboundMessageRepository,
  WebhookDeliveryRepository,
  WebhookEndpointRepository,
} from './repositories/integration-repository.js';
