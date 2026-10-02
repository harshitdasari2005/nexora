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
import type { ApprovalEngine } from '@nexora/ai-runtime';
import type { ConversationStore } from '@nexora/ai-runtime/conversation';
import {
  createDatabase,
  type NexoraDatabase,
  PgActivityRepository,
  PgBudgetRepository,
  PgCalendarEventRepository,
  PgDocumentRepository,
  PgExpenseRepository,
  PgDocumentTemplateRepository,
  PgDocumentVersionRepository,
  PgEmailOutboxRepository,
  PgInboundMessageRepository,
  PgEmployeeRepository,
  createTransactionalDatabase,
  PgCandidateRepository,
  PgHiringRequisitionRepository,
  PgJobOpeningRepository,
  PgOnboardingRepository,
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
import type { AiRuntime } from './ai/runtime.js';
import { createInitiatorCapabilityResolver } from './ai/workflow-initiator.js';
import { buildConnectorStore } from './ai/connectors/build-connector-store.js';
import type { ConnectorConnectionStore } from './ai/connectors/connection-store.js';
import { buildAgent } from './agent/build.js';
import { registerAgentRoutes } from './routes/agent.js';
import { registerAgentIdentityRoutes } from './routes/agents.js';
import { prefixedId } from '@nexora/shared/ids';
import type { AgentExecutionRecorder } from '@nexora/module-agents';
import { buildAgentIdentityLayer } from './agent/identity-layer.js';
import { PgAgentExecutionRecorder } from './agent/pg-agent-execution-recorder.js';
import {
  PgAgentDelegationRepository,
  PgAgentIdentityRepository,
} from './agent/pg-agent-identity-repository.js';
import type { PolicyEngine } from '@nexora/module-policy';
import { DecisionTraceService } from './audit/decision-trace.js';
import { buildLineageLayer } from './lineage/lineage-layer.js';
import { PgLineageRepository } from './lineage/pg-lineage-repository.js';
import { buildObservabilityLayer } from './observability/observability-layer.js';
import { PgRuntimeRunRepository } from './observability/pg-runtime-run-repository.js';
import { buildPolicyLayer } from './policy/policy-layer.js';
import { PgPolicySettingsRepository } from './policy/policy-settings.js';
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
import { authorizeApprovalDecision } from './ai/approval-authorization.js';
import { approvalRefusalReasonCode, createApprovalLifecycle } from './ai/approval-governance.js';
import { registerAiRoutes } from './routes/ai.js';
import { DemoService } from './demo/demo-service.js';
import { registerDemoDisabledRoutes, registerDemoRoutes } from './demo/routes.js';
import { readStoryFacts } from './demo/story-reader.js';
import { registerOriginGuard } from './plugins/origin-guard.js';
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
import { registerFinanceRoutes } from './routes/finance.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerEmployeeRoutes } from './routes/employees.js';
import { registerHiringRoutes } from './routes/hiring.js';
import { registerOnboardingRoutes } from './routes/onboarding.js';
import { registerRecruitingRoutes } from './routes/recruiting.js';
import { registerIntegrationsRoutes } from './routes/integrations.js';
import { registerKnowledgeRoutes } from './routes/knowledge.js';
import { registerDomainRoutes } from './routes/domains.js';
import { registerRoleContextRoutes } from './routes/role-context.js';
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
import { registerAuditRoutes } from './routes/audit.js';
import { registerRuntimeOpsRoutes } from './routes/runtime-ops.js';
import { registerPolicyRoutes } from './routes/policy.js';
import { PolicyAdminService } from './policy/policy-admin-service.js';
import { AuditQueryService } from './audit/audit-query-service.js';

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
  /**
   * The agent-authority clock (Prompt 4): delegation expiry is evaluated
   * against it at execution time. Tests and the evaluation harness inject a
   * controllable clock; defaults to the system clock.
   */
  agentClock?: () => Date;
  /**
   * The approval expiry clock (Prompt 8). Defaults to `agentClock` when
   * provided, so one controllable clock moves delegation expiry AND approval
   * expiry; otherwise the real clock.
   */
  approvalClock?: () => Date;
  /**
   * The approval engine (tests and the evaluation harness inject one to read
   * approval state back); defaults to the durable engine / an in-memory one.
   */
  approvals?: ApprovalEngine;
  /** Overrides the policy engine (tests inject additional rules). */
  policyEngine?: PolicyEngine;
  /**
   * Receives the composed AI runtime once (read-only observation seam for the
   * evaluation harness: it drives the app's REAL workflow service / tool
   * registry for the contrived closure scenarios). Never used by production.
   */
  onAiRuntime?: (runtime: AiRuntime) => void;
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

  // S24 Phase 3: the TRUSTED business context builder feeds every AI request
  // with the caller's domain/role/capability affinity — resolved from the
  // SAME membership seam the Command Center uses (one source of truth) and
  // the Phase 1 catalog. The model never supplies these values. Constructed
  // here (moved up from its original AI-routes-adjacent position) because
  // P0 security hardening now wires the SAME `rbac` dependency into the
  // resource routes (projects, employees, documents, knowledge, ...)
  // registered below, not just the AI/agent surface.
  const businessRoleResolver = new MembershipBusinessRoleResolver({
    memberships: repositories.memberships,
    workspaceMemberships: repositories.workspaceMemberships,
    workspaces: repositories.workspaces,
  });
  const domainCatalog = createInitialCatalog();
  // S34: the ONE RBAC permission-resolution dependency, shared by every route
  // that needs it — the SAME trusted resolver + catalog every other surface
  // (Command Center, AI, agent) already uses, never a second authorization
  // system.
  const rbac = { roleResolver: businessRoleResolver, catalog: domainCatalog };

  // The integration application service is composed AFTER the AI runtime
  // (its inbound router targets the existing ApprovalEngine); the webhook
  // dispatcher + email projection are registered onto the same chain.
  const integrationsPolicy = new NotificationPolicy();

  // Browser-origin guard (AUTH-008): registered before every route it protects.
  registerOriginGuard(app, { config: dependencies.config });
  registerAuth(app, { config: dependencies.config, sessions: container.sessionsService });
  registerHealth(app);
  // Demo World (explicit opt-in). When disabled these routes do not exist (404).
  // Registered before every business route so its request gate covers them all.
  if (dependencies.config.demo?.enabled === true) {
    const demo = new DemoService({
      repositories,
      database: dependencies.database,
      authenticate: container.authenticateWithOidc,
    });
    registerDemoRoutes(app, {
      config: dependencies.config,
      demo,
      sessions: container.sessionsService,
      endSession: container.endSession,
      readStoryFacts: (organizationId) =>
        readStoryFacts(
          {
            requisitions: container.hiringRequisitions,
            recruiting: container.recruiting,
            onboarding: container.onboarding,
            projects: repositories.projects,
            resourceAssignments: repositories.resourceAssignments,
            personaOfUser: (userId) => demo.personaOfUser(userId),
          },
          organizationId,
        ),
    });
    // Idempotent: seeds the deterministic demo organization when it is absent
    // or drifted, and never touches any other organization.
    app.addHook('onReady', async () => {
      await demo.seed();
      app.log.info({ organizationId: demo.ids.organizationId }, 'Demo world ready');
    });
  } else {
    registerDemoDisabledRoutes(app);
  }
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
    permissions: rbac,
  });
  registerEmployeeRoutes(app, {
    createEmployee: container.createEmployee,
    listEmployees: container.listEmployees,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
  });
  // Display names only — never an email fallback (same rule as the governance read models).
  const hiringDisplayName = async (userId: string): Promise<string | undefined> => {
    const user = await repositories.users.findById(userId as never);
    const displayName = user?.profile.displayName.value;
    return displayName === undefined || displayName.length === 0 ? undefined : displayName;
  };
  registerHiringRoutes(app, {
    requisitions: container.hiringRequisitions,
    recruiting: container.recruiting,
    projects: repositories.projects,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
    resolveUserName: hiringDisplayName,
  });
  registerOnboardingRoutes(app, {
    onboarding: container.onboarding,
    employees: repositories.employees,
    projects: repositories.projects,
    resourceAssignments: repositories.resourceAssignments,
    assignEmployeeToProject: container.assignEmployeeToProject,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
    resolveUserName: hiringDisplayName,
  });
  registerRecruitingRoutes(app, {
    recruiting: container.recruiting,
    requisitions: container.hiringRequisitions,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
    resolveUserName: hiringDisplayName,
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
    permissions: rbac,
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
    permissions: rbac,
  });
  registerMarketplaceRoutes(app, {
    installApp: container.installApp,
    updateApp: container.updateApp,
    uninstallApp: container.uninstallApp,
    listMarketplaceApps: container.listMarketplaceApps,
    listInstalledApps: container.listInstalledApps,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
  });
  registerCalendarRoutes(app, {
    createCalendarEvent: container.createCalendarEvent,
    updateCalendarEvent: container.updateCalendarEvent,
    cancelCalendarEvent: container.cancelCalendarEvent,
    listCalendarEvents: container.listCalendarEvents,
    getCalendarEvent: container.getCalendarEvent,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
  });
  registerFinanceRoutes(app, {
    createBudget: container.createBudget,
    reviseBudget: container.reviseBudget,
    closeBudget: container.closeBudget,
    clearBudgetReview: container.clearBudgetReview,
    flagOverBudgetItems: container.flagOverBudgetItems,
    listBudgets: container.listBudgets,
    getBudget: container.getBudget,
    listBudgetUtilization: container.listBudgetUtilization,
    submitExpense: container.submitExpense,
    decideExpense: container.decideExpense,
    listExpenses: container.listExpenses,
    getExpense: container.getExpense,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
    // Prompt 8: REST mutations consult the SAME central policy port as every
    // AI surface (composed below; resolved lazily at request time).
    restPolicy: () => ({ policy: policyLayer.port, securitySink: ai.securitySink }),
  });
  registerWorkspaceRoutes(app, {
    createWorkspace: container.createWorkspace,
    listWorkspaces: container.listWorkspaces,
    listOrganizations: container.listOrganizations,
    permissions: rbac,
  });
  registerDashboardRoutes(app, {
    getCurrentUser: container.getCurrentUser,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    roleResolver: businessRoleResolver,
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
    permissions: rbac,
    isSessionLive: (sessionId) => container.sessionsService.isLive(sessionId),
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

  // Prompt 4 — agent identity + delegated capabilities. ONE set of
  // repositories, ONE definition registry, ONE clock, and ONE authority
  // rule (`evaluateAgentAuthority`) shared by management (routes), the
  // execution-time check inside the ToolExecutor (chat/agent/MCP), and the
  // approval-resume path.
  const agentLayer = buildAgentIdentityLayer({
    repositories,
    container,
    rbac,
    publisher,
    ...(dependencies.agentClock === undefined ? {} : { clock: dependencies.agentClock }),
  });
  const agentStores = agentLayer.stores;
  const agentDefinitions = agentLayer.definitions;
  const capabilitiesOf = agentLayer.capabilitiesOf;
  const agentAuthority = agentLayer.authority;
  const agentIdentities = agentLayer.identities;

  const approvalClock = dependencies.approvalClock ?? dependencies.agentClock;
  const policyLayer = buildPolicyLayer({
    repositories,
    ...(dependencies.policyEngine === undefined ? {} : { engine: dependencies.policyEngine }),
    ...(dependencies.agentClock === undefined ? {} : { now: dependencies.agentClock }),
  });
  const lineageLayer = buildLineageLayer({ repositories });
  const observabilityLayer = buildObservabilityLayer({
    repositories,
    pricingJson: dependencies.config.observability?.modelPricingJson,
  });
  const ai = composeAiRuntime({
    rbac,
    config: dependencies.config,
    container,
    repositories,
    publisher,
    database: dependencies.database,
    aiStore: dependencies.aiStore,
    connectors,
    agentAuthority,
    policy: policyLayer.port,
    lineage: lineageLayer.port,
    runTelemetry: observabilityLayer.hub,
    ...(dependencies.agentClock === undefined ? {} : { extractionClock: dependencies.agentClock }),
    ...(approvalClock === undefined ? {} : { approvalClock }),
    ...(dependencies.approvals === undefined ? {} : { approvals: dependencies.approvals }),
  });
  dependencies.onAiRuntime?.(ai);
  const executionRecorder =
    dependencies.agentExecutionRecorder ??
    (dependencies.database === undefined
      ? undefined
      : new PgAgentExecutionRecorder(dependencies.database));
  // Approval lifecycle audit events + the (lazy / periodic-safe) expiry sweeper.
  const approvalLifecycle = createApprovalLifecycle(ai.approvals, publisher);
  const resolveUserName = async (userId: string): Promise<string | undefined> => {
    const user = await repositories.users.findById(userId as never);
    if (user === undefined) {
      return undefined;
    }
    const displayName = user.profile.displayName.value;
    return displayName.length > 0 ? displayName : user.email.value;
  };
  // Governance read models show display names only — never an email fallback.
  const resolveDisplayName = async (userId: string): Promise<string | undefined> => {
    const user = await repositories.users.findById(userId as never);
    const displayName = user?.profile.displayName.value;
    return displayName === undefined || displayName.length === 0 ? undefined : displayName;
  };
  registerAiRoutes(app, {
    orchestrator: ai.orchestrator,
    lifecycle: approvalLifecycle,
    resolveUserName,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    buildBusinessContext: (context) =>
      buildAIBusinessContext(
        { roleResolver: businessRoleResolver, catalog: domainCatalog },
        context,
      ),
    approvals: ai.approvals,
    conversations: ai.conversations,
    permissions: rbac,
    securitySink: ai.securitySink,
    // Prompt 4: agent-opened approvals resume AS the persisted agent, and the
    // resumed execution is journaled against that agent identity.
    agentPrincipals: agentStores.agents,
    resolveAgentEffectiveCapabilities: async ({ userId, tenantId, workspaceId, agentId }) => {
      if (workspaceId === undefined) {
        return undefined;
      }
      const inspected = await agentIdentities.inspectAgent(
        { userId, organizationId: tenantId, workspaceId, capabilityIds: [] },
        agentId,
      );
      return inspected.ok ? inspected.view.effectiveCapabilityIds : undefined;
    },
    onAgentApprovalExecuted: async ({ approval, principal, response }) => {
      if (executionRecorder === undefined || principal === undefined) {
        return;
      }
      const definition = agentDefinitions.get(principal.definitionId);
      const delegationIds = [
        ...new Set(
          response.steps
            .map((step) => step.delegationId)
            .filter((id): id is string => id !== undefined),
        ),
      ].sort();
      await executionRecorder.record({
        id: prefixedId('agx'),
        agentId: principal.definitionId,
        roleId: definition?.roleId ?? 'unknown',
        domainId: definition?.domainId ?? 'unknown',
        tenantId: approval.tenantId,
        ...(approval.workspaceId === undefined ? {} : { workspaceId: approval.workspaceId }),
        userId: approval.userId,
        proposalAction: `Approved action: ${approval.capabilityId}`,
        agentIdentityId: principal.id,
        ...(delegationIds.length === 0 ? {} : { delegationIds }),
        approvalId: approval.id,
        status: response.status as never,
        runId: response.runId,
        ...(response.status === 'completed' ? {} : { reason: response.response.slice(0, 500) }),
        createdAt: new Date().toISOString(),
      });
    },
  });
  registerWorkflowRoutes(app, {
    startWorkflow: new StartWorkflowHandler(ai.workflows),
    cancelWorkflow: new CancelWorkflowHandler(ai.workflows),
    getWorkflow: new GetWorkflowHandler(ai.workflows),
    listWorkflows: new ListWorkflowsHandler(ai.workflows),
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
    requiredCapabilities: (key) => ai.workflows.requiredCapabilities(key),
    initiatorCapabilities: createInitiatorCapabilityResolver(rbac),
    sideEffectOf: (toolId) => ai.tools.resolve(toolId)?.manifest.sideEffectClass,
    restPolicy: () => ({ policy: policyLayer.port, securitySink: ai.securitySink }),
    lineage: lineageLayer.repository,
    approvals: ai.approvals,
    sweepExpiredApprovals: () => approvalLifecycle.sweepExpiredApprovals(),
  });
  registerInsightsRoutes(app, {
    getTenantMeasurements: container.getTenantMeasurements,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
  });
  registerDomainRoutes(app, {
    listDomainCatalog: container.listDomainCatalog,
  });

  // S27 Phase 6: the role/context switcher read model. Reuses the SAME
  // trusted resolver + catalog as the Command Center/AI Runtime above —
  // batches the resolution across the caller's own memberships instead of
  // one workspace at a time.
  registerRoleContextRoutes(app, {
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    roleResolver: businessRoleResolver,
    catalog: domainCatalog,
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
      runtime: ai,
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
    // Prompt 4: `X-Nexora-Agent` sessions, validated server-side.
    resolveAgent: agentLayer.resolveSession,
    securitySink: ai.securitySink,
  });

  // S24 Phase 2: the generic role-aware Command Center. Composed here (not
  // in the container) because its data provider needs the application
  // handlers AND the AI runtime context is not required — the engine reuses
  // the existing application services; there is no second data-access layer.
  registerCommandCenterRoutes(app, {
    getCommandCenter: buildCommandCenter({
      memberships: repositories.memberships,
      workspaceMemberships: repositories.workspaceMemberships,
      workspaces: repositories.workspaces,
      getTenantMeasurements: container.getTenantMeasurements,
      listProjects: container.listProjects,
      listEmployees: container.listEmployees,
      listDocuments: container.listDocuments,
      listArticles: container.listArticles,
      listActivity: container.listActivity,
      listNotifications: container.listNotifications,
      listBudgetUtilization: container.listBudgetUtilization,
      listExpenses: container.listExpenses,
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
  const detectionSurface = buildDetection({
    getTenantMeasurements: container.getTenantMeasurements,
    listProjects: container.listProjects,
    listActivity: container.listActivity,
    listNotifications: container.listNotifications,
    listBudgetUtilization: container.listBudgetUtilization,
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
    workspaces: repositories.workspaces,
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
    // Prompt 4: one registry + persisted agent principals.
    registry: agentDefinitions,
    principals: agentStores.agents,
  });
  registerAgentRoutes(app, {
    getAgent: agentSurface.getAgent,
    executeAgent: agentSurface.executeAgent,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
    securitySink: ai.securitySink,
  });
  // Prompt 4: agent identities + delegated capabilities (management +
  // execution AS an agent principal).
  registerAgentIdentityRoutes(app, {
    identities: agentIdentities,
    executeAgent: agentSurface.executeAgent,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
    capabilitiesOf,
    securitySink: ai.securitySink,
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
    permissions: rbac,
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
    lineage: lineageLayer.repository,
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
    permissions: rbac,
  });

  // --- Audit Center --------------------------------------------------------
  // A READ-ONLY view over four EXISTING journals — never a second execution
  // engine, approval system, or audit log (see `audit/audit-query-service.ts`
  // for the full contract). Composed here, after both the agent-execution
  // recorder and the AI runtime's approval engine exist, since it reads both.
  registerAuditRoutes(app, {
    auditQuery: new AuditQueryService({
      agentExecutions: executionRecorder,
      approvals: ai.approvals,
      workflowStepExecutions: repositories.workflowStepExecutions,
      workflowInstances: repositories.workflowInstances,
      activity: repositories.activity,
      users: repositories.users,
      workspaces: repositories.workspaces,
      catalog: domainCatalog,
      agents: agentStores.agents,
    }),
    decisionTrace: new DecisionTraceService({
      approvals: ai.approvals,
      lineage: lineageLayer.repository,
      ...(executionRecorder === undefined ? {} : { agentExecutions: executionRecorder }),
      workflowStepExecutions: repositories.workflowStepExecutions,
      workflowInstances: repositories.workflowInstances,
      resolveUserName: resolveDisplayName,
      sideEffectOf: (toolId) => ai.tools.resolve(toolId)?.manifest.sideEffectClass,
    }),
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
  });

  registerPolicyRoutes(app, {
    policyAdmin: new PolicyAdminService({
      settings: policyLayer.settings,
      users: repositories.users,
      publisher,
    }),
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
  });

  registerRuntimeOpsRoutes(app, {
    runs: observabilityLayer.repository,
    approvals: ai.approvals,
    lineage: lineageLayer.repository,
    resolveUserName: resolveDisplayName,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
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
    routeInboundAction: async ({ action, targetId, decision, from, tenantId, workspaceId }) => {
      // Only the supported action catalog is routable (BKD §9.2):
      // `approval.decide` maps to the existing ApprovalEngine — no new
      // approval system (AIR.md §12). The actor is resolved from the
      // allowlisted sender, never from the request, and the decision is
      // authorized by the SAME rules as the REST decision route (requester,
      // membership, `approvals.decide`, capability still permitted, and the
      // approval's own workspace) — an email can never decide an approval
      // its sender could not decide in the app.
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
      await approvalLifecycle.sweepApprovals();
      const authorization = await authorizeApprovalDecision(
        {
          listOrganizations: container.listOrganizations,
          listMyWorkspaces: container.listMyWorkspaces,
          permissions: rbac,
          buildBusinessContext: (context) =>
            buildAIBusinessContext(
              { roleResolver: businessRoleResolver, catalog: domainCatalog },
              context,
            ),
        },
        { approval, deciderId: user.id, channelWorkspaceId: workspaceId },
      );
      if (!authorization.ok) {
        if (authorization.refusal === 'APPROVAL_EXPIRED') {
          // An expired approval is not decidable by any channel (never audited
          // as a security block — the expiry event was published on transition).
          return { ok: false, reason: 'expired' };
        }
        await ai.securitySink({
          actorId: user.id,
          origin: 'inbound_email',
          invocationId: approval.runId ?? approval.id,
          organizationId: approval.tenantId,
          ...(approval.workspaceId === undefined ? {} : { workspaceId: approval.workspaceId }),
          toolId: approval.toolId,
          capabilityId: approval.capabilityId,
          action: 'approval.decide',
          policyDecision: 'deny',
          reasonCode: approvalRefusalReasonCode(authorization.refusal),
          reason: `decision refused: ${authorization.refusal}`,
          outcome: 'blocked',
          occurredAt: new Date().toISOString(),
        });
        return { ok: false, reason: 'target-not-found' };
      }
      const outcome = await ai.approvals.decide(targetId, {
        decision: grant ? 'grant' : 'reject',
        decidedBy: user.id,
        reason: 'inbound email action',
      });
      if (outcome.ok) {
        await approvalLifecycle.publish({
          kind: grant ? 'granted' : 'rejected',
          approval: outcome.request,
          decidedBy: user.id,
        });
        return { ok: true };
      }
      if (outcome.reason === 'expired' && outcome.transitioned && outcome.request !== undefined) {
        await approvalLifecycle.publish({ kind: 'expired', approval: outcome.request });
      }
      return { ok: false, reason: outcome.reason };
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
    lineage: lineageLayer.repository,
    listOrganizations: container.listOrganizations,
    listMyWorkspaces: container.listMyWorkspaces,
    permissions: rbac,
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
  // The people records (candidate, seat count, employee, onboarding) are
  // written together or not at all: these repositories share one transaction
  // whenever a step runs inside `atomically`.
  const people = createTransactionalDatabase(database);
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
    employees: new PgEmployeeRepository(people.database),
    hiringRequisitions: new PgHiringRequisitionRepository(people.database),
    jobOpenings: new PgJobOpeningRepository(people.database),
    candidates: new PgCandidateRepository(people.database),
    onboardings: new PgOnboardingRepository(people.database),
    atomically: people.transaction,
    documents: new PgDocumentRepository(database),
    documentVersions: new PgDocumentVersionRepository(database),
    documentTemplates: new PgDocumentTemplateRepository(database),
    knowledgeSources: new PgKnowledgeSourceRepository(database),
    knowledgeArticles: new PgKnowledgeArticleRepository(database),
    knowledgeCategories: new PgKnowledgeCategoryRepository(database),
    calendarEvents: new PgCalendarEventRepository(database),
    budgets: new PgBudgetRepository(database),
    expenses: new PgExpenseRepository(database),
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
    agents: new PgAgentIdentityRepository(database),
    agentDelegations: new PgAgentDelegationRepository(database),
    policySettings: new PgPolicySettingsRepository(database),
    lineage: new PgLineageRepository(database),
    runtimeRuns: new PgRuntimeRunRepository(database),
  };
}

export { createDatabase };
