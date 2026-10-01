/**
 * @nexora/app-api — composition root (container).
 *
 * Wires the persistence repositories, domain services, and application
 * layer handlers together (BACKEND.md §2 dependency composition). The API
 * routes depend only on handlers from this container — never on domain or
 * infrastructure types directly.
 */

import type { AgentDelegationRepository, AgentIdentityRepository } from '@nexora/module-agents';
import type { EventPublisher } from '@nexora/shared/events';
import type { MembershipRepository, OrganizationRepository } from '@nexora/domain-organizations';
import type { RoleRepository, SessionRepository, UserRepository } from '@nexora/domain-identity';
import type { ProjectRepository, ResourceAssignmentRepository } from '@nexora/domain-projects';
import type { EmployeeRepository } from '@nexora/domain-hr';
import type {
  DocumentRepository,
  DocumentTemplateRepository,
  DocumentVersionRepository,
} from '@nexora/domain-documents';
import type {
  KnowledgeArticleRepository,
  KnowledgeCategoryRepository,
  KnowledgeSourceRepository,
} from '@nexora/domain-knowledge';
import type { CalendarEntryRepository } from '@nexora/module-calendar';
import type { BudgetRepository, ExpenseRepository } from '@nexora/module-finance';
import type { LineageRepository } from '@nexora/module-lineage';
import type { RuntimeRunRepository } from '@nexora/module-observability';
import type { PolicySettingsRepository } from './policy/policy-settings.js';
import type {
  EmailOutboxRepository,
  InboundMessageRepository,
  WebhookDeliveryRepository,
  WebhookEndpointRepository,
} from '@nexora/module-integrations';
import type { MeasurementRepository } from '@nexora/module-measurements';
import type { SearchIndexPort } from '@nexora/module-search';
import type {
  WorkspaceInstallationRepository,
  WorkspaceMembershipRepository,
  WorkspaceRepository,
} from '@nexora/domain-workspaces';
import type {
  WorkflowInstanceRepository,
  WorkflowStepExecutionRepository,
} from '@nexora/module-workflow';
import type {
  ActivityRepository,
  NotificationPreferencesRepository,
  NotificationRepository,
} from '@nexora/module-notifications';

import { MembershipDomainService, OrganizationDomainService } from '@nexora/domain-organizations';
import { SessionDomainService, UserDomainService } from '@nexora/domain-identity';
import { ProjectDomainService, ResourceAssignmentDomainService } from '@nexora/domain-projects';
import { EmployeeDomainService } from '@nexora/domain-hr';
import { DocumentDomainService } from '@nexora/domain-documents';
import { CalendarEntryDomainService } from '@nexora/module-calendar';
import { BudgetDomainService, ExpenseDomainService } from '@nexora/module-finance';
import { KnowledgeDomainService } from '@nexora/domain-knowledge';
import {
  WorkspaceDomainService,
  WorkspaceInstallationService,
  WorkspaceMembershipService,
} from '@nexora/domain-workspaces';
import {
  AuthenticateWithOidcHandler,
  EndSessionHandler,
  GetCurrentUserHandler,
  IdentityApplicationService,
} from '@nexora/application-identity';
import {
  CreateOrganizationHandler,
  ListOrganizationsHandler,
  OrganizationApplicationService,
} from '@nexora/application-organizations';
import {
  CreateWorkspaceHandler,
  InstallAppHandler,
  ListInstalledAppsHandler,
  ListMarketplaceAppsHandler,
  ListMyWorkspacesHandler,
  ListWorkspacesHandler,
  UninstallAppHandler,
  UpdateAppHandler,
  WorkspaceApplicationService,
} from '@nexora/application-workspaces';
import {
  AssignEmployeeToProjectHandler,
  CreateProjectHandler,
  FindProjectByNameHandler,
  ListProjectMembersHandler,
  ListProjectsHandler,
  ProjectApplicationService,
} from '@nexora/application-projects';
import {
  CreateEmployeeHandler,
  RevokeHireHandler,
  EmployeeApplicationService,
  FindEmployeeByNameHandler,
  ListEmployeesByIdsHandler,
  ListEmployeesHandler,
} from '@nexora/application-hr';
import {
  ArchiveDocumentHandler,
  ArchiveDocumentTemplateHandler,
  CreateDocumentFromTemplateHandler,
  CreateDocumentTemplateHandler,
  DocumentApplicationService,
  GetDocumentHandler,
  GetDocumentVersionContentHandler,
  ListDocumentTemplatesHandler,
  ListDocumentVersionsHandler,
  ListDocumentsHandler,
  RestoreDocumentVersionHandler,
  UploadDocumentHandler,
  UploadDocumentVersionHandler,
  type DocumentStorage,
  type DocumentTextExtractor,
} from '@nexora/application-documents';
import {
  CancelCalendarEventHandler,
  CalendarApplicationService,
  CreateCalendarEventHandler,
  GetCalendarEventHandler,
  ListCalendarEventsHandler,
  UpdateCalendarEventHandler,
} from '@nexora/application-calendar';
import {
  ClearBudgetReviewHandler,
  CloseBudgetHandler,
  CreateBudgetHandler,
  DecideExpenseHandler,
  FinanceApplicationService,
  FlagOverBudgetItemsHandler,
  GetBudgetHandler,
  GetExpenseHandler,
  ListBudgetUtilizationHandler,
  ListBudgetsHandler,
  ListExpensesHandler,
  ReviseBudgetHandler,
  SubmitExpenseHandler,
} from '@nexora/application-finance';
import {
  ArchiveArticleHandler,
  CreateArticleHandler,
  CreateCategoryHandler,
  GetArticleHandler,
  IndexArticleHandler,
  IndexDocumentHandler,
  KnowledgeApplicationService,
  ListArticlesHandler,
  ListCategoriesHandler,
  PublishArticleHandler,
  RemoveArticleIndexHandler,
  RemoveDocumentIndexHandler,
  RetrieveKnowledgeHandler,
  UpdateArticleHandler,
} from '@nexora/application-knowledge';
import {
  GetNotificationPreferencesHandler,
  ListActivityHandler,
  ListNotificationsHandler,
  MarkAllNotificationsReadHandler,
  MarkNotificationReadHandler,
  NotificationApplicationService,
  UnreadNotificationsCountHandler,
  UpdateNotificationPreferencesHandler,
} from '@nexora/module-notifications';
import {
  GetTenantMeasurementsHandler,
  MeasurementApplicationService,
} from '@nexora/module-measurements';
import { ScryptPasswordHasher } from '@nexora/persistence';
import {
  createInitialCatalog,
  DomainApplicationService,
  GetDomainCatalogHandler,
} from '@nexora/module-domains';

import type { ApiConfig } from './config.js';

/** Every repository port the container needs (implemented or faked). */
export interface RepositorySet {
  users: UserRepository;
  sessions: SessionRepository;
  roles: RoleRepository;
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  workspaces: WorkspaceRepository;
  workspaceMemberships: WorkspaceMembershipRepository;
  workspaceInstallations: WorkspaceInstallationRepository;
  projects: ProjectRepository;
  resourceAssignments: ResourceAssignmentRepository;
  employees: EmployeeRepository;
  documents: DocumentRepository;
  documentVersions: DocumentVersionRepository;
  documentTemplates: DocumentTemplateRepository;
  knowledgeSources: KnowledgeSourceRepository;
  knowledgeArticles: KnowledgeArticleRepository;
  knowledgeCategories: KnowledgeCategoryRepository;
  calendarEvents: CalendarEntryRepository;
  budgets: BudgetRepository;
  expenses: ExpenseRepository;
  webhookEndpoints: WebhookEndpointRepository;
  webhookDeliveries: WebhookDeliveryRepository;
  emailOutbox: EmailOutboxRepository;
  inboundMessages: InboundMessageRepository;
  measurements: MeasurementRepository;
  searchIndex: SearchIndexPort;
  documentStorage: DocumentStorage;
  documentExtractor: DocumentTextExtractor;
  workflowInstances: WorkflowInstanceRepository;
  workflowStepExecutions: WorkflowStepExecutionRepository;
  notifications: NotificationRepository;
  notificationPreferences: NotificationPreferencesRepository;
  activity: ActivityRepository;
  /**
   * Agent identities (Prompt 4). Optional so existing hand-built sets keep
   * compiling; `buildApp` falls back to an in-memory store when absent.
   */
  agents?: AgentIdentityRepository;
  /** Agent delegations (Prompt 4); in-memory fallback when absent. */
  agentDelegations?: AgentDelegationRepository;
  /** Organization policy configuration (Prompt 5); in-memory fallback when absent. */
  policySettings?: PolicySettingsRepository;
  /** Append-only evidence + lineage (Prompt 6); in-memory fallback when absent. */
  lineage?: LineageRepository;
  /** Append-only runtime observability runs (Prompt 7); in-memory fallback when absent. */
  runtimeRuns?: RuntimeRunRepository;
}

/** The wired application handlers and shared services exposed to routes. */
export interface Container {
  /** The session domain service (used by the auth plugin). */
  sessionsService: SessionDomainService;
  /** OIDC authentication handler. */
  authenticateWithOidc: AuthenticateWithOidcHandler;
  /** Logout handler. */
  endSession: EndSessionHandler;
  /** Current-user query handler. */
  getCurrentUser: GetCurrentUserHandler;
  /** Organization creation handler. */
  createOrganization: CreateOrganizationHandler;
  /** Organization listing handler. */
  listOrganizations: ListOrganizationsHandler;
  /** Workspace creation handler. */
  createWorkspace: CreateWorkspaceHandler;
  /** Workspace listing handler. */
  listWorkspaces: ListWorkspacesHandler;
  /** Membership-scoped workspace listing (the AI authorization query). */
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** Marketplace app install handler (S19, permission review). */
  installApp: InstallAppHandler;
  /** Marketplace app update handler (S19). */
  updateApp: UpdateAppHandler;
  /** Marketplace app uninstall handler (S19). */
  uninstallApp: UninstallAppHandler;
  /** Marketplace catalog + installed-state listing handler (S19). */
  listMarketplaceApps: ListMarketplaceAppsHandler;
  /** Installed-apps listing handler (S19). */
  listInstalledApps: ListInstalledAppsHandler;
  /** Project creation handler. */
  createProject: CreateProjectHandler;
  /** Project listing handler. */
  listProjects: ListProjectsHandler;
  /** Tenant-scoped project name resolution (the AI resolution query). */
  findProjectByName: FindProjectByNameHandler;
  /** Employee→project assignment handler. */
  assignEmployeeToProject: AssignEmployeeToProjectHandler;
  /** Project member listing handler. */
  listProjectMembers: ListProjectMembersHandler;
  /** Employee creation handler. */
  createEmployee: CreateEmployeeHandler;
  /** Hire compensation (the workflow rollback of the hire step). */
  revokeHire: RevokeHireHandler;
  /** Employee listing handler. */
  listEmployees: ListEmployeesHandler;
  /** Tenant-scoped employee name resolution (the AI authorization query). */
  findEmployeeByName: FindEmployeeByNameHandler;
  /** Tenant-scoped employee id lookup (member display join). */
  listEmployeesByIds: ListEmployeesByIdsHandler;
  /** Document upload handler. */
  uploadDocument: UploadDocumentHandler;
  /** Document archive handler. */
  archiveDocument: ArchiveDocumentHandler;
  /** Workspace-scoped document listing handler. */
  listDocuments: ListDocumentsHandler;
  /** Single-document read handler. */
  getDocument: GetDocumentHandler;
  /** Version-history listing handler (S17). */
  listDocumentVersions: ListDocumentVersionsHandler;
  /** New-version upload handler (S17). */
  uploadDocumentVersion: UploadDocumentVersionHandler;
  /** Version-restore handler (S17). */
  restoreDocumentVersion: RestoreDocumentVersionHandler;
  /** Version-content read handler (S17). */
  getDocumentVersionContent: GetDocumentVersionContentHandler;
  /** Template creation handler (S17). */
  createDocumentTemplate: CreateDocumentTemplateHandler;
  /** Template-picker listing handler (S17). */
  listDocumentTemplates: ListDocumentTemplatesHandler;
  /** Template archive handler (S17). */
  archiveDocumentTemplate: ArchiveDocumentTemplateHandler;
  /** Create-document-from-template handler (S17). */
  createDocumentFromTemplate: CreateDocumentFromTemplateHandler;
  /** Calendar-entry creation handler. */
  createCalendarEvent: CreateCalendarEventHandler;
  /** Calendar-entry reschedule handler. */
  updateCalendarEvent: UpdateCalendarEventHandler;
  /** Calendar-entry cancellation handler. */
  cancelCalendarEvent: CancelCalendarEventHandler;
  /** Workspace-scoped calendar-entry listing handler. */
  listCalendarEvents: ListCalendarEventsHandler;
  /** Single calendar-entry read handler. */
  getCalendarEvent: GetCalendarEventHandler;
  /** Budget creation handler (S35). */
  createBudget: CreateBudgetHandler;
  /** Budget revision handler (S35). */
  reviseBudget: ReviseBudgetHandler;
  /** Budget close handler (S35). */
  closeBudget: CloseBudgetHandler;
  /** Budget review-flag clear handler (S35). */
  clearBudgetReview: ClearBudgetReviewHandler;
  /** Deterministic over-threshold budget flagging handler (S35 remediation). */
  flagOverBudgetItems: FlagOverBudgetItemsHandler;
  /** Workspace-scoped budget listing handler (S35). */
  listBudgets: ListBudgetsHandler;
  /** Single-budget read handler (S35). */
  getBudget: GetBudgetHandler;
  /** Workspace-scoped budget-utilization handler (S35). */
  listBudgetUtilization: ListBudgetUtilizationHandler;
  /** Expense submission handler (S35). */
  submitExpense: SubmitExpenseHandler;
  /** Expense decision (approve/reject) handler (S35). */
  decideExpense: DecideExpenseHandler;
  /** Workspace-scoped expense listing handler (S35). */
  listExpenses: ListExpensesHandler;
  /** Single-expense read handler (S35). */
  getExpense: GetExpenseHandler;
  /** Knowledge retrieval handler (permission-filtered search). */
  retrieveKnowledge: RetrieveKnowledgeHandler;
  /** Knowledge indexing handler (document → knowledge ingest). */
  indexDocument: IndexDocumentHandler;
  /** Knowledge index-removal handler (archive cleans the projection). */
  removeDocumentIndex: RemoveDocumentIndexHandler;
  /** Article creation handler (S18). */
  createArticle: CreateArticleHandler;
  /** Article update handler (S18). */
  updateArticle: UpdateArticleHandler;
  /** Article publish handler (S18). */
  publishArticle: PublishArticleHandler;
  /** Article archive handler (S18). */
  archiveArticle: ArchiveArticleHandler;
  /** Single-article read handler (S18). */
  getArticle: GetArticleHandler;
  /** Workspace-scoped article listing handler (S18). */
  listArticles: ListArticlesHandler;
  /** Category creation handler (S18). */
  createCategory: CreateCategoryHandler;
  /** Workspace-scoped category listing handler (S18). */
  listCategories: ListCategoriesHandler;
  /** Published-article corpus indexing handler (S18). */
  indexArticle: IndexArticleHandler;
  /** Article corpus-removal handler (S18). */
  removeArticleIndex: RemoveArticleIndexHandler;
  /** Notification inbox listing handler (recipient = authenticated user). */
  listNotifications: ListNotificationsHandler;
  /** Unread notification count handler. */
  unreadNotifications: UnreadNotificationsCountHandler;
  /** Pilot measurement dashboard handler (S23). */
  getTenantMeasurements: GetTenantMeasurementsHandler;
  /** Mark-one-notification-read handler (recipient-scoped). */
  markNotificationRead: MarkNotificationReadHandler;
  /** Mark-all-read handler (recipient-scoped). */
  markAllNotificationsRead: MarkAllNotificationsReadHandler;
  /** Notification preferences read handler. */
  getNotificationPreferences: GetNotificationPreferencesHandler;
  /** Notification preferences update handler. */
  updateNotificationPreferences: UpdateNotificationPreferencesHandler;
  /** Activity feed listing handler (workspace-scoped). */
  listActivity: ListActivityHandler;
  /** Read-only Domain → Role → Capability discovery handler (S24 Phase 1). */
  listDomainCatalog: GetDomainCatalogHandler;
}

/** Inputs required to build the container. */
export interface BuildContainerOptions {
  /** API configuration. */
  config: ApiConfig;
  /** Repository implementations (PostgreSQL or in-memory fakes). */
  repositories: RepositorySet;
  /** The domain event publisher. */
  publisher: EventPublisher;
}

/** Builds the application container (composition root). */
export function buildContainer(options: BuildContainerOptions): Container {
  const { repositories, publisher } = options;
  const hasher = new ScryptPasswordHasher();

  // Identity domain services.
  const usersService = new UserDomainService({
    users: repositories.users,
    roles: repositories.roles,
    sessions: repositories.sessions,
    hasher,
  });
  const sessionsService = new SessionDomainService({
    sessions: repositories.sessions,
    users: repositories.users,
    hasher,
  });

  // Organizations domain services.
  const organizationsService = new OrganizationDomainService({
    organizations: repositories.organizations,
  });
  const membershipsService = new MembershipDomainService({
    memberships: repositories.memberships,
    organizations: repositories.organizations,
  });

  // Workspaces domain services.
  const workspacesService = new WorkspaceDomainService({
    workspaces: repositories.workspaces,
  });
  const workspaceMembershipsService = new WorkspaceMembershipService({
    memberships: repositories.workspaceMemberships,
    workspaces: repositories.workspaces,
  });
  const workspaceInstallationService = new WorkspaceInstallationService({
    installations: repositories.workspaceInstallations,
    workspaces: repositories.workspaces,
  });

  // Projects domain services (lifecycle + resource assignment).
  const projectsService = new ProjectDomainService({
    projects: repositories.projects,
  });
  const resourceAssignmentService = new ResourceAssignmentDomainService({
    projects: repositories.projects,
    assignments: repositories.resourceAssignments,
  });

  // HR domain service.
  const employeesService = new EmployeeDomainService({
    employees: repositories.employees,
  });

  // Documents domain service (lifecycle + S17 version history + templates).
  const documentsService = new DocumentDomainService({
    documents: repositories.documents,
    versions: repositories.documentVersions,
    templates: repositories.documentTemplates,
  });

  // Calendar domain service.
  const calendarEntriesService = new CalendarEntryDomainService({
    entries: repositories.calendarEvents,
  });

  // Finance domain services (S35).
  const budgetsDomainService = new BudgetDomainService({
    budgets: repositories.budgets,
  });
  const expensesDomainService = new ExpenseDomainService({
    expenses: repositories.expenses,
  });

  // Application services.
  const identityService = new IdentityApplicationService({
    users: repositories.users,
    usersService,
    sessionsService,
    publisher,
  });
  const organizationService = new OrganizationApplicationService({
    organizationsService,
    membershipsService,
    membershipsRepository: repositories.memberships,
    publisher,
  });
  const workspaceService = new WorkspaceApplicationService({
    workspacesService,
    membershipsService: workspaceMembershipsService,
    installationsService: workspaceInstallationService,
    publisher,
  });
  const projectService = new ProjectApplicationService({
    projectsService,
    assignmentsService: resourceAssignmentService,
    publisher,
  });
  const employeeService = new EmployeeApplicationService({
    employeesService,
    publisher,
  });
  const documentService = new DocumentApplicationService({
    documentsService,
    documents: repositories.documents,
    storage: repositories.documentStorage,
    extractor: repositories.documentExtractor,
    publisher,
  });
  const calendarService = new CalendarApplicationService({
    entriesService: calendarEntriesService,
    publisher,
  });
  const financeService = new FinanceApplicationService({
    budgetsService: budgetsDomainService,
    expensesService: expensesDomainService,
    publisher,
  });
  const knowledgeDomainService = new KnowledgeDomainService({
    articles: repositories.knowledgeArticles,
    categories: repositories.knowledgeCategories,
  });
  const knowledgeService = new KnowledgeApplicationService({
    sources: repositories.knowledgeSources,
    searchIndex: repositories.searchIndex,
    publisher,
    knowledgeService: knowledgeDomainService,
  });
  const notificationService = new NotificationApplicationService({
    notifications: repositories.notifications,
    preferences: repositories.notificationPreferences,
    activity: repositories.activity,
  });
  const measurementService = new MeasurementApplicationService(repositories.measurements);

  // S24 Phase 1: the Domain → Role → Capability definition catalog. Code/
  // config registered (no database): validated at startup, resolved from
  // memory, read-only. Grants nothing — the existing authorization system
  // remains authoritative (ROLE ≠ PERMISSION).
  const domainCatalogService = new DomainApplicationService(createInitialCatalog());

  return {
    sessionsService,
    authenticateWithOidc: new AuthenticateWithOidcHandler(identityService),
    endSession: new EndSessionHandler(identityService),
    getCurrentUser: new GetCurrentUserHandler(identityService),
    createOrganization: new CreateOrganizationHandler(organizationService),
    listOrganizations: new ListOrganizationsHandler(organizationService),
    createWorkspace: new CreateWorkspaceHandler(workspaceService),
    listWorkspaces: new ListWorkspacesHandler(workspaceService),
    listMyWorkspaces: new ListMyWorkspacesHandler(workspaceService),
    installApp: new InstallAppHandler(workspaceService),
    updateApp: new UpdateAppHandler(workspaceService),
    uninstallApp: new UninstallAppHandler(workspaceService),
    listMarketplaceApps: new ListMarketplaceAppsHandler(workspaceService),
    listInstalledApps: new ListInstalledAppsHandler(workspaceService),
    createProject: new CreateProjectHandler(projectService),
    listProjects: new ListProjectsHandler(projectService),
    findProjectByName: new FindProjectByNameHandler(projectService),
    assignEmployeeToProject: new AssignEmployeeToProjectHandler(projectService),
    listProjectMembers: new ListProjectMembersHandler(projectService),
    createEmployee: new CreateEmployeeHandler(employeeService),
    revokeHire: new RevokeHireHandler(employeeService),
    listEmployees: new ListEmployeesHandler(employeeService),
    findEmployeeByName: new FindEmployeeByNameHandler(employeeService),
    listEmployeesByIds: new ListEmployeesByIdsHandler(employeeService),
    uploadDocument: new UploadDocumentHandler(documentService),
    archiveDocument: new ArchiveDocumentHandler(documentService),
    listDocuments: new ListDocumentsHandler(documentService),
    getDocument: new GetDocumentHandler(documentService),
    listDocumentVersions: new ListDocumentVersionsHandler(documentService),
    uploadDocumentVersion: new UploadDocumentVersionHandler(documentService),
    restoreDocumentVersion: new RestoreDocumentVersionHandler(documentService),
    getDocumentVersionContent: new GetDocumentVersionContentHandler(documentService),
    createDocumentTemplate: new CreateDocumentTemplateHandler(documentService),
    listDocumentTemplates: new ListDocumentTemplatesHandler(documentService),
    archiveDocumentTemplate: new ArchiveDocumentTemplateHandler(documentService),
    createDocumentFromTemplate: new CreateDocumentFromTemplateHandler(documentService),
    createCalendarEvent: new CreateCalendarEventHandler(calendarService),
    updateCalendarEvent: new UpdateCalendarEventHandler(calendarService),
    cancelCalendarEvent: new CancelCalendarEventHandler(calendarService),
    listCalendarEvents: new ListCalendarEventsHandler(calendarService),
    getCalendarEvent: new GetCalendarEventHandler(calendarService),
    createBudget: new CreateBudgetHandler(financeService),
    reviseBudget: new ReviseBudgetHandler(financeService),
    closeBudget: new CloseBudgetHandler(financeService),
    clearBudgetReview: new ClearBudgetReviewHandler(financeService),
    flagOverBudgetItems: new FlagOverBudgetItemsHandler(financeService),
    listBudgets: new ListBudgetsHandler(financeService),
    getBudget: new GetBudgetHandler(financeService),
    listBudgetUtilization: new ListBudgetUtilizationHandler(financeService),
    submitExpense: new SubmitExpenseHandler(financeService),
    decideExpense: new DecideExpenseHandler(financeService),
    listExpenses: new ListExpensesHandler(financeService),
    getExpense: new GetExpenseHandler(financeService),
    retrieveKnowledge: new RetrieveKnowledgeHandler(knowledgeService),
    indexDocument: new IndexDocumentHandler(knowledgeService),
    removeDocumentIndex: new RemoveDocumentIndexHandler(knowledgeService),
    createArticle: new CreateArticleHandler(knowledgeService),
    updateArticle: new UpdateArticleHandler(knowledgeService),
    publishArticle: new PublishArticleHandler(knowledgeService),
    archiveArticle: new ArchiveArticleHandler(knowledgeService),
    getArticle: new GetArticleHandler(knowledgeService),
    listArticles: new ListArticlesHandler(knowledgeService),
    createCategory: new CreateCategoryHandler(knowledgeService),
    listCategories: new ListCategoriesHandler(knowledgeService),
    indexArticle: new IndexArticleHandler(knowledgeService),
    removeArticleIndex: new RemoveArticleIndexHandler(knowledgeService),
    listNotifications: new ListNotificationsHandler(notificationService),
    unreadNotifications: new UnreadNotificationsCountHandler(notificationService),
    markNotificationRead: new MarkNotificationReadHandler(notificationService),
    markAllNotificationsRead: new MarkAllNotificationsReadHandler(notificationService),
    getNotificationPreferences: new GetNotificationPreferencesHandler(notificationService),
    updateNotificationPreferences: new UpdateNotificationPreferencesHandler(notificationService),
    listActivity: new ListActivityHandler(notificationService),
    getTenantMeasurements: new GetTenantMeasurementsHandler(measurementService),
    listDomainCatalog: new GetDomainCatalogHandler(domainCatalogService),
  };
}
