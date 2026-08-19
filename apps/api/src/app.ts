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

import { NotificationPolicy } from '@nexora/module-notifications';
import { Email } from '@nexora/domain-identity';
import {
  DevEmailSink,
  EmailProjection,
  IntegrationApplicationService,
  WebhookDispatcher,
  type WebhookHttpClient,
} from '@nexora/module-integrations';

import type { ApiConfig } from './config.js';
import { buildApplicationEventPublisher } from './events/application-publisher.js';
import { toHttpError } from './http/errors.js';
import type { OidcGateway } from './oidc/gateway.js';
import { registerAuth } from './plugins/auth.js';
import { buildContainer, type RepositorySet } from './container.js';
import { composeAiRuntime } from './ai/compose.js';
import { buildConnectorStore } from './ai/connectors/build-connector-store.js';
import type { ConnectorConnectionStore } from './ai/connectors/connection-store.js';
import { buildAgent } from './agent/build.js';
import { registerAgentRoutes } from './routes/agent.js';
import type { AgentExecutionRecorder } from '@nexora/module-agents';
import { PgAgentExecutionRecorder } from './agent/pg-agent-execution-recorder.js';
import { buildDetection } from './detection/build.js';
import { PgBusinessProblemStore } from './agent/pg-business-problem-store.js';
import { InMemoryProblemStore } from './detection/in-memory-problem-store.js';
import type { ProblemStore } from '@nexora/module-detection';
import {
  buildRemediation,
  ApiRemediationExecutionPort,
  ApiRemediationExecutionRecorder,
} from './remediation/build.js';
import { PgPlanStore } from './remediation/pg-plan-store.js';
import { InMemoryPlanStore, type PlanStore } from '@nexora/module-remediation';
import { registerRemediationRoutes } from './routes/remediation.js';
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
import { registerCommandCenterRoutes } from './routes/command-center.js';
import { buildCommandCenter } from './command-center/build.js';
import { buildNexoraMCPServer } from './ai/mcp/build-server.js';
import {
  buildAIBusinessContext,
  MembershipBusinessRoleResolver,
} from './business-context/index.js';
import { createInitialCatalog } from '@nexora/module-domains';
import { registerInsightsRoutes } from './routes/insights.js';
import { registerMarketplaceRoutes } from './routes/marketplace.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerOrganizationRoutes } from './routes/organizations.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerProblemsRoutes } from './routes/problems.js';
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
  /**
   * External connector connection store (S25 Phase 7). Tests inject a
   * fixture-backed store; defaults to the env-configured store (empty when
   * no connector credentials are configured).
   */
  connectors?: ConnectorConnectionStore;
  /**
   * The durable agent-execution journal (S26 Phase 8 measurements). Tests
   * inject an in-memory recorder; defaults to the PostgreSQL recorder when
   * a database is available (absent otherwise — executions still run but
   * are not journaled).
   */
  agentExecutionRecorder?: AgentExecutionRecorder;
  /**
   * The durable business-problem store (S27). Tests inject an in-memory
   * store; defaults to the PostgreSQL store when a database is available
   * (absent otherwise — detection still runs but problems are ephemeral).
   */
  problemStore?: ProblemStore;
  /**
   * The durable remediation plan store (Phase 10). Tests inject an
   * in-memory store; defaults to the PostgreSQL store when a database is
   * available (absent otherwise — plans are ephemeral).
   */
  planStore?: PlanStore;
}

/** Builds the Nexora API application. */
export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: dependencies.config.logLevel } });
  await app.register(cookie);

  const repositories =
    dependencies.repositories ?? buildPgRepositories(dependencies.database, dependencies.config);

  // The v1 event backbone: the notification consumer projects business
  // events into recipient-scoped notifications and the workspace activity
  // feed; webhooks + email are registered onto the same chain below. Shared
  // with the MCP server entry — one event pipeline for HTTP and MCP
  // (S24 Phase 5: MCP never bypasses audit).
  const { publisher, stream: notificationStream } = buildApplicationEventPublisher({
    repositories,
    basePublisher: dependencies.publisher,
    logger: app.log,
  });
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
  // registering capabilities, never by modifying it (AIR.md §5). The same
  // composition powers the Nexora MCP server (S24 Phase 5) — one runtime
  // wiring for HTTP and MCP.
  // S25 Phase 7: external enterprise connectors. Built from the deployment
  // config (env credentials + binding tenant); empty when not configured.
  const connectors =
    dependencies.connectors ??
    buildConnectorStore({
      githubToken: dependencies.config.connectors.githubToken,
      slackToken: dependencies.config.connectors.slackToken,
      tenantId: dependencies.config.connectors.tenantId,
    });

  const ai = composeAiRuntime({
    config: dependencies.config,
    container,
    repositories,
    publisher,
    database: dependencies.database,
    aiStore: dependencies.aiStore,
    connectors,
  });
  // S24 Phase 3: the TRUSTED business context builder feeds every AI request
  // with the caller's domain/role/capability affinity — resolved from the
  // SAME membership seam the Command Center uses (one source of truth) and
  // the Phase 1 catalog. The model never supplies these values.
  const businessRoleResolver = new MembershipBusinessRoleResolver({
    memberships: repositories.memberships,
    workspaceMemberships: repositories.workspaceMemberships,
  });
  const domainCatalog = createInitialCatalog();
  registerAiRoutes(app, {
    orchestrator: ai.orchestrator,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    buildBusinessContext: (context) =>
      buildAIBusinessContext(
        { roleResolver: businessRoleResolver, catalog: domainCatalog },
        context,
      ),
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

  // S24 Phase 6: the AUTHENTICATED remote MCP surface. The route reuses the
  // session authentication + membership validation of every other route and
  // delegates to the SAME Nexora MCP engine (capability-aware discovery,
  // governed execution, durable approvals) that the stdio entry serves —
  // one engine, two transports.
  registerMcpRoutes(app, {
    // No fixed identity: the HTTP surface resolves each session's trusted
    // context from the authenticated request (per-session contexts).
    server: await buildNexoraMCPServer({
      runtime: { tools: ai.tools, approvals: ai.approvals },
      resolveBusinessContext: (context) =>
        buildAIBusinessContext(
          { roleResolver: businessRoleResolver, catalog: domainCatalog },
          context,
        ),
    }),
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    buildBusinessContext: (context) =>
      buildAIBusinessContext(
        { roleResolver: businessRoleResolver, catalog: domainCatalog },
        context,
      ),
  });

  // S24 Phase 2: the generic role-aware Command Center. Composed here (not
  // in the container) because its data provider needs the application
  // handlers AND the AI runtime context is not required — the engine reuses
  // the existing application services; there is no second data-access layer.
  registerCommandCenterRoutes(app, {
    getCommandCenter: buildCommandCenter({
      memberships: repositories.memberships,
      workspaceMemberships: repositories.workspaceMemberships,
      getTenantMeasurements: container.getTenantMeasurements,
      listProjects: container.listProjects,
      listEmployees: container.listEmployees,
      listDocuments: container.listDocuments,
      listArticles: container.listArticles,
      listActivity: container.listActivity,
      listNotifications: container.listNotifications,
    }),
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
  });

  // S26 Phase 8: the governed business-agent surface. Composed here (not in
  // the container) for the same reason as the Command Center: the engine
  // reuses the SAME trusted membership role-resolution seam, the EXISTING
  // application services (measurements, projects, activity, notifications)
  // derive governed proposals from real persisted data, and execution runs
  // through the EXISTING AI Runtime (one engine, one approval system) with
  // discovery restricted to the agent's registered capability set. Outcomes
  // are journaled into `agent_executions` when a database is available.
  // S27: the proactive detection surface. Composed here next to the agent
  // surface it feeds: the TRUSTED snapshot is built from the SAME existing
  // application handlers the S26 proposals read, solution discovery reuses
  // the EXISTING permission-filtered knowledge seam + execution journal
  // (never a second search infrastructure), and the problem store is the
  // minimum durable lifecycle state (`business_problems`). The generic
  // engine never decides tenant/workspace/role/capability/authorization —
  // those stay with the trusted context and the S26 agent surface.
  const executionRecorder =
    dependencies.agentExecutionRecorder ??
    (dependencies.database === undefined
      ? undefined
      : new PgAgentExecutionRecorder(dependencies.database));
  const detectionSurface = buildDetection({
    getTenantMeasurements: container.getTenantMeasurements,
    listProjects: container.listProjects,
    listActivity: container.listActivity,
    listNotifications: container.listNotifications,
    retrieveKnowledge: container.retrieveKnowledge,
    executionRecorder,
    publisher,
    problemStore:
      dependencies.problemStore ??
      (dependencies.database === undefined
        ? new InMemoryProblemStore()
        : new PgBusinessProblemStore(dependencies.database)),
  });
  const agentSurface = buildAgent({
    memberships: repositories.memberships,
    workspaceMemberships: repositories.workspaceMemberships,
    getTenantMeasurements: container.getTenantMeasurements,
    listProjects: container.listProjects,
    listActivity: container.listActivity,
    listNotifications: container.listNotifications,
    orchestrator: ai.orchestrator,
    buildBusinessContext: (context) =>
      buildAIBusinessContext(
        { roleResolver: businessRoleResolver, catalog: domainCatalog },
        context,
      ),
    executionRecorder,
    // S27 agent integration: detected problems surface in the agent DTO and
    // their action proposals flow through the SAME governed execution path.
    problems: detectionSurface.problems,
  });
  registerAgentRoutes(app, {
    getAgent: agentSurface.getAgent,
    executeAgent: agentSurface.executeAgent,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
  });
  // S27 problems console: the dedicated HTTP surface over the SAME
  // detection engine that feeds the agent DTO. The routes resolve the
  // trusted tenant/workspace scope and bound problem-derived action
  // proposals to the caller's EFFECTIVE agent capability set (the same
  // membership → role → agent seam the agent DTO uses — a caller without an
  // agent gets the investigation, never an action proposal).
  registerProblemsRoutes(app, {
    scan: detectionSurface.scan,
    list: detectionSurface.list,
    getById: detectionSurface.getById,
    getAgentCapabilities: agentSurface.getCapabilities,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
  });
  // Phase 10: the governed remediation surface. Composed here next to the
  // detection + agent surfaces it builds on: the agent resolver is the SAME
  // membership → role → agent seam (side-effect-free definition resolver),
  // the problem provider/reevaluator/lifecycle are the SAME S27 detection
  // engine, capabilities resolve from the EXISTING AI Runtime registry,
  // approvals go through the EXISTING ApprovalEngine, steps execute through
  // the SAME governed execution path (AI Runtime → ToolExecutor → approval
  // → verification → decision), and outcomes journal into the SAME
  // agent-execution journal (plan-linked rows). There is no second engine,
  // no second approval system, no second journal.
  const remediationSurface = buildRemediation({
    store:
      dependencies.planStore ??
      (dependencies.database === undefined
        ? new InMemoryPlanStore()
        : new PgPlanStore(dependencies.database)),
    getAgentDefinition: agentSurface.getDefinition,
    getProblem: (context, problemId) =>
      detectionSurface.getById.handle(
        {
          userId: context.userId,
          tenantId: context.tenantId as never,
          workspaceId: context.workspaceId,
          agentCapabilityIds: [],
        },
        problemId,
      ),
    listProblemsByIds: (context, problemIds) =>
      detectionSurface.listByIds.handle(
        {
          userId: context.userId,
          tenantId: context.tenantId as never,
          workspaceId: context.workspaceId,
          agentCapabilityIds: [],
        },
        problemIds,
      ),
    reevaluate: (context, problemId) =>
      detectionSurface.reevaluate.handle(
        {
          userId: context.userId,
          tenantId: context.tenantId as never,
          workspaceId: context.workspaceId,
          agentCapabilityIds: [],
        },
        problemId,
      ),
    transitionProblem: (context, problemId, status, now) =>
      detectionSurface.transition(context, problemId, status, now),
    registry: ai.registry,
    tools: ai.tools,
    approvals: ai.approvals,
    execution: new ApiRemediationExecutionPort({
      orchestrator: ai.orchestrator,
      conversations: ai.store,
      buildBusinessContext: (context) =>
        buildAIBusinessContext(
          { roleResolver: businessRoleResolver, catalog: domainCatalog },
          context,
        ),
    }),
    recorder:
      executionRecorder === undefined
        ? undefined
        : new ApiRemediationExecutionRecorder(executionRecorder),
  });
  registerRemediationRoutes(app, {
    remediation: remediationSurface,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
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
      const approval = await ai.approvals.byId(targetId);
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
      const outcome = await ai.approvals.decide(targetId, {
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
export function buildPgRepositories(
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
