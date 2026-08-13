/**
 * @nexora/app-api — composition root (container).
 *
 * Wires the persistence repositories, domain services, and application
 * layer handlers together (BACKEND.md §2 dependency composition). The API
 * routes depend only on handlers from this container — never on domain or
 * infrastructure types directly.
 */

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
import type { KnowledgeSourceRepository } from '@nexora/domain-knowledge';
import type { CalendarEntryRepository } from '@nexora/module-calendar';
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
import { WorkspaceDomainService, WorkspaceMembershipService } from '@nexora/domain-workspaces';
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
  ListMyWorkspacesHandler,
  ListWorkspacesHandler,
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
  IndexDocumentHandler,
  KnowledgeApplicationService,
  RemoveDocumentIndexHandler,
  RetrieveKnowledgeHandler,
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
import { ScryptPasswordHasher } from '@nexora/persistence';

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
  calendarEvents: CalendarEntryRepository;
  searchIndex: SearchIndexPort;
  documentStorage: DocumentStorage;
  documentExtractor: DocumentTextExtractor;
  workflowInstances: WorkflowInstanceRepository;
  workflowStepExecutions: WorkflowStepExecutionRepository;
  notifications: NotificationRepository;
  notificationPreferences: NotificationPreferencesRepository;
  activity: ActivityRepository;
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
  /** Knowledge retrieval handler (permission-filtered search). */
  retrieveKnowledge: RetrieveKnowledgeHandler;
  /** Knowledge indexing handler (document → knowledge ingest). */
  indexDocument: IndexDocumentHandler;
  /** Knowledge index-removal handler (archive cleans the projection). */
  removeDocumentIndex: RemoveDocumentIndexHandler;
  /** Notification inbox listing handler (recipient = authenticated user). */
  listNotifications: ListNotificationsHandler;
  /** Unread notification count handler. */
  unreadNotifications: UnreadNotificationsCountHandler;
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
  const knowledgeService = new KnowledgeApplicationService({
    sources: repositories.knowledgeSources,
    searchIndex: repositories.searchIndex,
    publisher,
  });
  const notificationService = new NotificationApplicationService({
    notifications: repositories.notifications,
    preferences: repositories.notificationPreferences,
    activity: repositories.activity,
  });

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
    createProject: new CreateProjectHandler(projectService),
    listProjects: new ListProjectsHandler(projectService),
    findProjectByName: new FindProjectByNameHandler(projectService),
    assignEmployeeToProject: new AssignEmployeeToProjectHandler(projectService),
    listProjectMembers: new ListProjectMembersHandler(projectService),
    createEmployee: new CreateEmployeeHandler(employeeService),
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
    retrieveKnowledge: new RetrieveKnowledgeHandler(knowledgeService),
    indexDocument: new IndexDocumentHandler(knowledgeService),
    removeDocumentIndex: new RemoveDocumentIndexHandler(knowledgeService),
    listNotifications: new ListNotificationsHandler(notificationService),
    unreadNotifications: new UnreadNotificationsCountHandler(notificationService),
    markNotificationRead: new MarkNotificationReadHandler(notificationService),
    markAllNotificationsRead: new MarkAllNotificationsReadHandler(notificationService),
    getNotificationPreferences: new GetNotificationPreferencesHandler(notificationService),
    updateNotificationPreferences: new UpdateNotificationPreferencesHandler(notificationService),
    listActivity: new ListActivityHandler(notificationService),
  };
}
