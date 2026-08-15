/**
 * @nexora/app-api — application factory.
 *
 * Builds the Fastify application from dependencies. `buildApp` is pure
 * composition: routes depend on handlers from the container, and the
 * container depends on repository implementations (PostgreSQL or in-memory
 * fakes in tests). This makes the whole onboarding surface testable with
 * `fastify.inject` and no external services.
 */

import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { EventPublisher } from '@nexora/shared/events';
import type { ConversationStore } from '@nexora/ai-runtime/conversation';
import {
  createDatabase,
  type NexoraDatabase,
  PgActivityRepository,
  PgCalendarEventRepository,
  PgDocumentRepository,
  PgDocumentTemplateRepository,
  PgDocumentVersionRepository,
  PgEmailOutboxRepository,
  PgInboundMessageRepository,
  PgEmployeeRepository,
  PgKnowledgeArticleRepository,
  PgKnowledgeCategoryRepository,
  PgKnowledgeIndexStore,
  PgKnowledgeSourceRepository,
  PgMeasurementRepository,
  PgMembershipRepository,
  PgNotificationPreferencesRepository,
  PgNotificationRepository,
  PgOrganizationRepository,
  PgProjectRepository,
  PgResourceAssignmentRepository,
  PgRoleRepository,
  PgSessionRepository,
  PgUserRepository,
  PgWebhookDeliveryRepository,
  PgWebhookEndpointRepository,
  PgWorkflowInstanceRepository,
  PgWorkflowStepExecutionRepository,
  PgWorkspaceInstallationRepository,
  PgWorkspaceMembershipRepository,
  PgWorkspaceRepository,
} from '@nexora/persistence';
import {
  DefaultDocumentTextExtractor,
  InMemoryDocumentStorage,
} from '@nexora/application-documents';

import { MinioDocumentStorage } from './storage/minio-document-storage.js';

import {
  NotificationEventConsumer,
  NotificationPolicy,
  NotificationStream,
} from '@nexora/module-notifications';
import { Email } from '@nexora/domain-identity';
import {
  DevEmailSink,
  EmailProjection,
  IntegrationApplicationService,
  WebhookDispatcher,
  type WebhookHttpClient,
} from '@nexora/module-integrations';

import type { ApiConfig } from './config.js';
import { LoggingEventPublisher } from './events/logging-event-publisher.js';
import { ProjectionChainPublisher } from './events/projection-chain-publisher.js';
import { toHttpError } from './http/errors.js';
import type { OidcGateway } from './oidc/gateway.js';
import { registerAuth } from './plugins/auth.js';
import { buildContainer, type RepositorySet } from './container.js';
import { PgConversationStore } from './ai/pg-conversation-store.js';
import { buildAiRuntime } from './ai/runtime.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerHealth } from './routes/health.js';
import { registerMeRoutes } from './routes/me.js';
import {
  CancelWorkflowHandler,
  GetWorkflowHandler,
  ListWorkflowsHandler,
  StartWorkflowHandler,
} from '@nexora/module-workflow';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerEmployeeRoutes } from './routes/employees.js';
import { registerIntegrationsRoutes } from './routes/integrations.js';
import { registerKnowledgeRoutes } from './routes/knowledge.js';
import { registerDomainRoutes } from './routes/domains.js';
import { registerInsightsRoutes } from './routes/insights.js';
import { registerMarketplaceRoutes } from './routes/marketplace.js';
import { registerOrganizationRoutes } from './routes/organizations.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';

/** Dependencies required to build the application. */
export interface AppDependencies {
  /** API configuration. */
  config: ApiConfig;
  /** The OIDC gateway. */
  oidc: OidcGateway;
  /** PostgreSQL client (used unless `repositories` are provided). */
  database?: NexoraDatabase;
  /** Repository implementations (tests inject in-memory fakes). */
  repositories?: RepositorySet;
  /** Event publisher (defaults to the structured-log publisher). */
  publisher?: EventPublisher;
  /** Durable AI conversation store (defaults to in-memory without a database). */
  aiStore?: ConversationStore;
  /** Webhook delivery transport (defaults to fetch — tests inject a fake). */
  webhookHttp?: WebhookHttpClient;
}

/** Builds the Nexora API application. */
export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: dependencies.config.logLevel } });
  await app.register(cookie);

  const repositories =
    dependencies.repositories ?? buildPgRepositories(dependencies.database, dependencies.config);
  const basePublisher = dependencies.publisher ?? new LoggingEventPublisher(app.log);

  // Notification platform: the consumer projects business events into
  // recipient-scoped notifications and the workspace activity feed. It rides
  // the EventPublisher seam (the v1 event backbone) — no second event bus.
  const notificationStream = new NotificationStream();
  const notificationConsumer = new NotificationEventConsumer({
    policy: new NotificationPolicy(),
    notifications: repositories.notifications,
    preferences: repositories.notificationPreferences,
    activity: repositories.activity,
    publisher: basePublisher,
    stream: notificationStream,
    logger: app.log,
  });
  // The v1 event backbone: every domain event flows through this chain to
  // the projections (notifications, and — registered below — webhooks +
  // email) before the base publisher. No second event bus (SAD.md §11).
  const publisher = new ProjectionChainPublisher(basePublisher, [notificationConsumer]);
  const container = buildContainer({ config: dependencies.config, repositories, publisher });

  // The integration application service is composed AFTER the AI runtime
  // (its inbound router targets the existing ApprovalEngine); the webhook
  // dispatcher + email projection are registered onto the same chain.
  const integrationsPolicy = new NotificationPolicy();

  registerAuth(app, { config: dependencies.config, sessions: container.sessionsService });
  registerHealth(app);
  registerMeRoutes(app, {
    getCurrentUser: container.getCurrentUser,
    listOrganizations: container.listOrganizations,
  });
  registerAuthRoutes(app, {
    config: dependencies.config,
    oidc: dependencies.oidc,
    authenticate: container.authenticateWithOidc,
    endSession: container.endSession,
  });
  registerOrganizationRoutes(app, {
    createOrganization: container.createOrganization,
    listOrganizations: container.listOrganizations,
  });
  registerProjectRoutes(app, {
    createProject: container.createProject,
    listProjects: container.listProjects,
    listProjectMembers: container.listProjectMembers,
    listEmployeesByIds: container.listEmployeesByIds,
    listOrganizations: container.listOrganizations,
  });
  registerEmployeeRoutes(app, {
    createEmployee: container.createEmployee,
    listEmployees: container.listEmployees,
    listOrganizations: container.listOrganizations,
  });
  registerDocumentRoutes(app, {
    uploadDocument: container.uploadDocument,
    archiveDocument: container.archiveDocument,
    listDocuments: container.listDocuments,
    getDocument: container.getDocument,
    listDocumentVersions: container.listDocumentVersions,
    uploadDocumentVersion: container.uploadDocumentVersion,
    restoreDocumentVersion: container.restoreDocumentVersion,
    getDocumentVersionContent: container.getDocumentVersionContent,
    createDocumentTemplate: container.createDocumentTemplate,
    listDocumentTemplates: container.listDocumentTemplates,
    archiveDocumentTemplate: container.archiveDocumentTemplate,
    createDocumentFromTemplate: container.createDocumentFromTemplate,
    indexDocument: container.indexDocument,
    removeDocumentIndex: container.removeDocumentIndex,
    retrieveKnowledge: container.retrieveKnowledge,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
  });
  registerKnowledgeRoutes(app, {
    createArticle: container.createArticle,
    updateArticle: container.updateArticle,
    publishArticle: container.publishArticle,
    archiveArticle: container.archiveArticle,
    getArticle: container.getArticle,
    listArticles: container.listArticles,
    createCategory: container.createCategory,
    listCategories: container.listCategories,
    indexArticle: container.indexArticle,
    removeArticleIndex: container.removeArticleIndex,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
  });
  registerMarketplaceRoutes(app, {
    installApp: container.installApp,
    updateApp: container.updateApp,
    uninstallApp: container.uninstallApp,
    listMarketplaceApps: container.listMarketplaceApps,
    listInstalledApps: container.listInstalledApps,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
  });
  registerCalendarRoutes(app, {
    createCalendarEvent: container.createCalendarEvent,
    updateCalendarEvent: container.updateCalendarEvent,
    cancelCalendarEvent: container.cancelCalendarEvent,
    listCalendarEvents: container.listCalendarEvents,
    getCalendarEvent: container.getCalendarEvent,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
  });
  registerWorkspaceRoutes(app, {
    createWorkspace: container.createWorkspace,
    listWorkspaces: container.listWorkspaces,
    listOrganizations: container.listOrganizations,
  });
  registerDashboardRoutes(app, {
    getCurrentUser: container.getCurrentUser,
    listOrganizations: container.listOrganizations,
    listWorkspaces: container.listWorkspaces,
  });
  registerNotificationRoutes(app, {
    listNotifications: container.listNotifications,
    unreadNotifications: container.unreadNotifications,
    markNotificationRead: container.markNotificationRead,
    markAllNotificationsRead: container.markAllNotificationsRead,
    getNotificationPreferences: container.getNotificationPreferences,
    updateNotificationPreferences: container.updateNotificationPreferences,
    listActivity: container.listActivity,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    stream: notificationStream,
  });

  // Enterprise AI Runtime: register the workspaces capability surface and
  // expose the chat endpoint. The runtime is generic — apps plug into it by
  // registering capabilities, never by modifying it (AIR.md §5).
  const ai = buildAiRuntime({
    config: dependencies.config,
    listMyWorkspaces: container.listMyWorkspaces,
    createWorkspace: container.createWorkspace,
    createProject: container.createProject,
    findProjectByName: container.findProjectByName,
    findEmployeeByName: container.findEmployeeByName,
    createEmployee: container.createEmployee,
    createCalendarEvent: container.createCalendarEvent,
    assignEmployeeToProject: container.assignEmployeeToProject,
    retrieveKnowledge: container.retrieveKnowledge,
    listOrganizations: container.listOrganizations,
    listNotifications: container.listNotifications,
    unreadNotifications: container.unreadNotifications,
    listActivity: container.listActivity,
    workflowInstances: repositories.workflowInstances,
    workflowStepExecutions: repositories.workflowStepExecutions,
    publisher,
    store:
      dependencies.aiStore ??
      (dependencies.database === undefined
        ? undefined
        : new PgConversationStore(dependencies.database)),
  });
  registerAiRoutes(app, {
    orchestrator: ai.orchestrator,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    approvals: ai.approvals,
    conversations: ai.conversations,
  });
  registerWorkflowRoutes(app, {
    startWorkflow: new StartWorkflowHandler(ai.workflows),
    cancelWorkflow: new CancelWorkflowHandler(ai.workflows),
    getWorkflow: new GetWorkflowHandler(ai.workflows),
    listWorkflows: new ListWorkflowsHandler(ai.workflows),
    listOrganizations: container.listOrganizations,
  });
  registerInsightsRoutes(app, {
    getTenantMeasurements: container.getTenantMeasurements,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
  });
  registerDomainRoutes(app, {
    listDomainCatalog: container.listDomainCatalog,
  });

  // --- Integrations platform (S20) ----------------------------------------
  // Composed here (after the AI runtime) so the inbound email action router
  // can target the existing ApprovalEngine (BKD §9.2). The webhook
  // dispatcher + email projection ride the SAME event backbone as the
  // notification consumer — no second event bus.
  const integrationService = new IntegrationApplicationService({
    endpoints: repositories.webhookEndpoints,
    deliveries: repositories.webhookDeliveries,
    emailOutbox: repositories.emailOutbox,
    inboundMessages: repositories.inboundMessages,
    emailSender: new DevEmailSink((record) => {
      app.log.info(
        { emailId: record.id, to: record.recipientEmail, subject: record.subject },
        'email dispatched (dev sink)',
      );
    }),
    // The inbound sender allowlist: only a user whose email belongs to a
    // member of the organization AND the workspace may trigger inbound
    // email actions (the ONE authorization model — never from the request).
    isSenderAllowed: async ({ tenantId, workspaceId, from }) => {
      let email: ReturnType<typeof Email.create> | undefined;
      try {
        email = Email.create(from);
      } catch {
        return false;
      }
      const user = await repositories.users.findByEmail(email);
      if (user === undefined) {
        return false;
      }
      const membership = await repositories.memberships.findByOrganizationAndUser(
        tenantId as never,
        user.id as never,
      );
      if (membership === undefined) {
        return false;
      }
      const wsMembership = await repositories.workspaceMemberships.findByWorkspaceAndUser(
        workspaceId as never,
        user.id as never,
      );
      return wsMembership !== undefined;
    },
    routeInboundAction: async ({ action, targetId, decision, from, tenantId }) => {
      // Only the supported action catalog is routable (BKD §9.2):
      // `approval.decide` maps to the existing ApprovalEngine — no new
      // approval system (AIR.md §12). The actor is resolved from the
      // allowlisted sender, never from the request.
      if (action !== 'approval.decide') {
        return { ok: false, reason: 'unknown-action' };
      }
      let email: ReturnType<typeof Email.create> | undefined;
      try {
        email = Email.create(from);
      } catch {
        return { ok: false, reason: 'sender-not-found' };
      }
      const user = await repositories.users.findByEmail(email);
      if (user === undefined) {
        return { ok: false, reason: 'sender-not-found' };
      }
      const approval = ai.approvals.byId(targetId);
      if (approval === undefined || approval.tenantId !== tenantId) {
        // Forged or foreign approval ids resolve to a hard NOT FOUND — the
        // approval never grants another tenant's run.
        return { ok: false, reason: 'target-not-found' };
      }
      const grant = decision === 'grant';
      const reject = decision === 'reject';
      if (!grant && !reject) {
        return { ok: false, reason: 'invalid-decision' };
      }
      const outcome = ai.approvals.decide(targetId, {
        decision: grant ? 'grant' : 'reject',
        decidedBy: user.id,
        reason: 'inbound email action',
      });
      // Exactly-once: a duplicate inbound delivery resolves to
      // already_decided — the action never executes twice.
      return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
    },
    publisher,
  });
  const webhookDispatcher = new WebhookDispatcher({
    endpoints: repositories.webhookEndpoints,
    deliveries: repositories.webhookDeliveries,
    publisher,
    logger: app.log,
    http: dependencies.webhookHttp,
  });
  const emailProjection = new EmailProjection({
    policy: integrationsPolicy,
    service: integrationService,
    userEmails: {
      findEmailByUserId: async (userId) => {
        const user = await repositories.users.findById(userId as never);
        return user?.email.value;
      },
    },
    logger: app.log,
  });
  publisher.addProjections([webhookDispatcher, emailProjection]);
  registerIntegrationsRoutes(app, {
    integrations: integrationService,
    inboundSecret: dependencies.config.integrations.inboundSecret,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error, requestId: request.id }, 'request failed');
    // Preserve framework-level client errors (e.g. schema validation 400s).
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          requestId: request.id,
        },
      });
    }
    const http = toHttpError(error, request.id);
    return reply.code(http.statusCode).send(http.body);
  });

  return app;
}

/** Builds the PostgreSQL repository set from the database client. */
function buildPgRepositories(
  database: NexoraDatabase | undefined,
  config: ApiConfig,
): RepositorySet {
  if (database === undefined) {
    throw new Error(
      'No repositories or database provided: pass either `repositories` (fakes) or `database` (PostgreSQL).',
    );
  }
  return {
    users: new PgUserRepository(database),
    sessions: new PgSessionRepository(database),
    roles: new PgRoleRepository(database),
    organizations: new PgOrganizationRepository(database),
    memberships: new PgMembershipRepository(database),
    workspaces: new PgWorkspaceRepository(database),
    workspaceMemberships: new PgWorkspaceMembershipRepository(database),
    workspaceInstallations: new PgWorkspaceInstallationRepository(database),
    projects: new PgProjectRepository(database),
    resourceAssignments: new PgResourceAssignmentRepository(database),
    employees: new PgEmployeeRepository(database),
    documents: new PgDocumentRepository(database),
    documentVersions: new PgDocumentVersionRepository(database),
    documentTemplates: new PgDocumentTemplateRepository(database),
    knowledgeSources: new PgKnowledgeSourceRepository(database),
    knowledgeArticles: new PgKnowledgeArticleRepository(database),
    knowledgeCategories: new PgKnowledgeCategoryRepository(database),
    calendarEvents: new PgCalendarEventRepository(database),
    webhookEndpoints: new PgWebhookEndpointRepository(database),
    webhookDeliveries: new PgWebhookDeliveryRepository(database),
    emailOutbox: new PgEmailOutboxRepository(database),
    inboundMessages: new PgInboundMessageRepository(database),
    measurements: new PgMeasurementRepository(database),
    searchIndex: new PgKnowledgeIndexStore(database),
    // Durable content when S3/MinIO is configured; in-memory storage for
    // local dev without object storage (the port contract is identical).
    documentStorage:
      config.s3 === undefined ? new InMemoryDocumentStorage() : new MinioDocumentStorage(config.s3),
    documentExtractor: new DefaultDocumentTextExtractor(),
    workflowInstances: new PgWorkflowInstanceRepository(database),
    workflowStepExecutions: new PgWorkflowStepExecutionRepository(database),
    notifications: new PgNotificationRepository(database),
    notificationPreferences: new PgNotificationPreferencesRepository(database),
    activity: new PgActivityRepository(database),
  };
}

export { createDatabase };
