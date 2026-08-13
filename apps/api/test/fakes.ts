/**
 * Test-only fakes for the API tests: in-memory repository implementations
 * for every domain port and a {@link FakeOidcGateway}. Enables the whole
 * onboarding flow with `fastify.inject` and no external services.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';

import type {
  PasswordHasher,
  Role,
  RoleRepository,
  Session,
  SessionRepository,
  User,
  UserRepository,
} from '@nexora/domain-identity';
import { PasswordHash, type Email, type Username } from '@nexora/domain-identity';
import type {
  MembershipRepository,
  Organization,
  OrganizationMembership,
  OrganizationRepository,
} from '@nexora/domain-organizations';
import type { OrganizationId, OrganizationSlug } from '@nexora/domain-organizations';
import type {
  Project,
  ProjectId,
  ProjectRepository,
  ResourceAssignment,
  ResourceAssignmentRepository,
} from '@nexora/domain-projects';
import type { AssignmentId } from '@nexora/domain-projects';
import type { Employee, EmployeeRepository } from '@nexora/domain-hr';
import type { CalendarEntry, CalendarEntryRepository } from '@nexora/module-calendar';
import type {
  Document,
  DocumentRepository,
  DocumentTemplate,
  DocumentTemplateRepository,
  DocumentVersion,
  DocumentVersionRepository,
} from '@nexora/domain-documents';
import type { DocumentId } from '@nexora/domain-documents';
import type {
  KnowledgeArticle,
  KnowledgeArticleRepository,
  KnowledgeCategory,
  KnowledgeCategoryRepository,
  KnowledgeSource,
  KnowledgeSourceRepository,
} from '@nexora/domain-knowledge';
import type { KnowledgeArticleId } from '@nexora/domain-knowledge';
import type { KnowledgeCategoryId } from '@nexora/domain-knowledge';
import type { KnowledgeSourceId } from '@nexora/domain-knowledge';
import type {
  Workspace,
  WorkspaceInstallation,
  WorkspaceInstallationRepository,
  WorkspaceMembership,
  WorkspaceMembershipRepository,
  WorkspaceRepository,
} from '@nexora/domain-workspaces';
import type { WorkspaceId, WorkspaceSlug } from '@nexora/domain-workspaces';
import type {
  WorkflowInstance,
  WorkflowInstanceRepository,
  WorkflowStepExecution,
  WorkflowStepExecutionRepository,
} from '@nexora/module-workflow';
import type {
  ActivityItem,
  ActivityRepository,
  Notification,
  NotificationPreferences,
  NotificationPreferencesRepository,
  NotificationRepository,
} from '@nexora/module-notifications';

import type {
  OidcCallbackParams,
  OidcGateway,
  OidcIdentity,
  PkceParameters,
} from '../src/oidc/gateway.js';

/** An in-memory {@link UserRepository}. */
export class FakeUserRepository implements UserRepository {
  readonly users = new Map<UserId, User>();

  async findById(id: UserId): Promise<User | undefined> {
    return this.users.get(id);
  }

  async findByEmail(email: Email): Promise<User | undefined> {
    for (const user of this.users.values()) {
      if (user.email.equals(email)) {
        return user;
      }
    }
    return undefined;
  }

  async findByUsername(username: Username): Promise<User | undefined> {
    for (const user of this.users.values()) {
      if (user.username.equals(username)) {
        return user;
      }
    }
    return undefined;
  }

  async existsByEmail(email: Email, tenantId: TenantId): Promise<boolean> {
    return this.findByEmail(email).then((user) => user?.tenantId === tenantId);
  }

  async existsByUsername(username: Username, tenantId: TenantId): Promise<boolean> {
    return this.findByUsername(username).then((user) => user?.tenantId === tenantId);
  }

  async save(user: User): Promise<void> {
    this.users.set(user.id, user);
  }
}

/** An in-memory {@link SessionRepository}. */
export class FakeSessionRepository implements SessionRepository {
  readonly sessions = new Map<string, Session>();
  readonly byToken = new Map<string, Session>();

  async findById(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async findByToken(token: string): Promise<Session | undefined> {
    return this.byToken.get(token);
  }

  async findActiveByUser(userId: UserId): Promise<readonly Session[]> {
    return [...this.sessions.values()].filter(
      (session) => session.userId === userId && session.status.isActive(),
    );
  }

  async countActiveByUser(userId: UserId): Promise<number> {
    return (await this.findActiveByUser(userId)).length;
  }

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    this.byToken.set(session.token, session);
  }
}

/** An in-memory {@link RoleRepository} (unused by the onboarding slice). */
export class FakeRoleRepository implements RoleRepository {
  readonly roles = new Map<string, Role>();

  async findByName(name: string): Promise<Role | undefined> {
    return this.roles.get(name);
  }

  async findById(id: string): Promise<Role | undefined> {
    for (const role of this.roles.values()) {
      if (role.id === id) {
        return role;
      }
    }
    return undefined;
  }

  async listByTenant(tenantId: TenantId): Promise<readonly Role[]> {
    return [...this.roles.values()].filter(
      (role) => role.tenantId === undefined || role.tenantId === tenantId,
    );
  }

  async save(role: Role): Promise<void> {
    this.roles.set(role.name, role);
  }
}

/** An in-memory {@link OrganizationRepository}. */
export class FakeOrganizationRepository implements OrganizationRepository {
  readonly organizations = new Map<string, Organization>();

  async findById(id: OrganizationId): Promise<Organization | undefined> {
    return this.organizations.get(id);
  }

  async findBySlug(slug: OrganizationSlug): Promise<Organization | undefined> {
    for (const organization of this.organizations.values()) {
      if (organization.slug.value === slug.value) {
        return organization;
      }
    }
    return undefined;
  }

  async existsBySlug(slug: OrganizationSlug): Promise<boolean> {
    return (await this.findBySlug(slug)) !== undefined;
  }

  async listByIds(ids: readonly OrganizationId[]): Promise<readonly Organization[]> {
    return [...this.organizations.values()].filter((organization) => ids.includes(organization.id));
  }

  async save(organization: Organization): Promise<void> {
    this.organizations.set(organization.id, organization);
  }
}

/** An in-memory {@link MembershipRepository}. */
export class FakeMembershipRepository implements MembershipRepository {
  readonly memberships = new Map<string, OrganizationMembership>();

  async findById(id: string): Promise<OrganizationMembership | undefined> {
    return this.memberships.get(id);
  }

  async findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMembership | undefined> {
    for (const membership of this.memberships.values()) {
      if (membership.organizationId === organizationId && membership.userId === userId) {
        return membership;
      }
    }
    return undefined;
  }

  async listByOrganization(
    organizationId: OrganizationId,
  ): Promise<readonly OrganizationMembership[]> {
    return [...this.memberships.values()].filter(
      (membership) => membership.organizationId === organizationId,
    );
  }

  async listByUser(userId: UserId): Promise<readonly OrganizationMembership[]> {
    return [...this.memberships.values()].filter((membership) => membership.userId === userId);
  }

  async countOwners(organizationId: OrganizationId): Promise<number> {
    return (await this.listByOrganization(organizationId)).filter((membership) =>
      membership.isOwner(),
    ).length;
  }

  async save(membership: OrganizationMembership): Promise<void> {
    this.memberships.set(membership.id, membership);
  }

  async remove(membership: OrganizationMembership): Promise<void> {
    this.memberships.delete(membership.id);
  }
}

/**
 * A {@link MembershipRepository} whose read queries fail. Used to verify the
 * dashboard (and routes) surface read-model failures instead of silently
 * degrading (no error-swallowing).
 */
export class FailingMembershipRepository extends FakeMembershipRepository {
  override async listByUser(): Promise<readonly OrganizationMembership[]> {
    throw new Error('simulated membership read failure');
  }
}

/** An in-memory {@link WorkspaceRepository}. */
export class FakeWorkspaceRepository implements WorkspaceRepository {
  readonly workspaces = new Map<string, Workspace>();

  async findById(id: WorkspaceId): Promise<Workspace | undefined> {
    return this.workspaces.get(id);
  }

  async findBySlug(organizationId: TenantId, slug: WorkspaceSlug): Promise<Workspace | undefined> {
    for (const workspace of this.workspaces.values()) {
      if (workspace.organizationId === organizationId && workspace.slug.value === slug.value) {
        return workspace;
      }
    }
    return undefined;
  }

  async existsBySlug(organizationId: TenantId, slug: WorkspaceSlug): Promise<boolean> {
    return (await this.findBySlug(organizationId, slug)) !== undefined;
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly Workspace[]> {
    return [...this.workspaces.values()].filter(
      (workspace) => workspace.organizationId === organizationId,
    );
  }

  async listByIds(ids: readonly WorkspaceId[]): Promise<readonly Workspace[]> {
    return [...this.workspaces.values()].filter((workspace) =>
      (ids as readonly string[]).includes(workspace.id),
    );
  }

  async save(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }
}

/** An in-memory {@link ProjectRepository}. */
export class FakeProjectRepository implements ProjectRepository {
  readonly projects = new Map<string, Project>();

  async findById(id: ProjectId): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async findByName(organizationId: TenantId, name: string): Promise<readonly Project[]> {
    const term = name.trim().toLowerCase();
    return [...this.projects.values()].filter(
      (project) =>
        project.organizationId === organizationId &&
        project.name.value.toLowerCase().includes(term),
    );
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly Project[]> {
    return [...this.projects.values()].filter(
      (project) => project.organizationId === organizationId,
    );
  }

  async save(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }
}

/** An in-memory {@link DocumentRepository}. */
export class FakeDocumentRepository implements DocumentRepository {
  readonly documents = new Map<string, Document>();

  async findById(id: DocumentId): Promise<Document | undefined> {
    return this.documents.get(id);
  }

  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: string,
  ): Promise<readonly Document[]> {
    return [...this.documents.values()]
      .filter(
        (document) =>
          document.organizationId === organizationId && document.workspaceId === workspaceId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async save(document: Document): Promise<void> {
    this.documents.set(document.id, document);
  }
}

/** An in-memory {@link DocumentVersionRepository} (immutable history). */
export class FakeDocumentVersionRepository implements DocumentVersionRepository {
  readonly versions = new Map<string, DocumentVersion>();

  async listByDocument(documentId: DocumentId): Promise<readonly DocumentVersion[]> {
    return [...this.versions.values()]
      .filter((version) => version.documentId === documentId)
      .sort((a, b) => a.version - b.version);
  }

  async findByDocumentAndVersion(
    documentId: DocumentId,
    version: number,
  ): Promise<DocumentVersion | undefined> {
    return [...this.versions.values()].find(
      (record) => record.documentId === documentId && record.version === version,
    );
  }

  async save(version: DocumentVersion): Promise<void> {
    this.versions.set(version.id, version);
  }
}

/** An in-memory {@link DocumentTemplateRepository}. */
export class FakeDocumentTemplateRepository implements DocumentTemplateRepository {
  readonly templates = new Map<string, DocumentTemplate>();

  async findById(templateId: string): Promise<DocumentTemplate | undefined> {
    return this.templates.get(templateId);
  }

  async listActiveByWorkspace(
    organizationId: TenantId,
    workspaceId: string,
  ): Promise<readonly DocumentTemplate[]> {
    return [...this.templates.values()].filter(
      (template) =>
        template.organizationId === organizationId &&
        template.workspaceId === workspaceId &&
        template.isActive(),
    );
  }

  async save(template: DocumentTemplate): Promise<void> {
    this.templates.set(template.id, template);
  }
}

/** An in-memory {@link KnowledgeSourceRepository}. */
export class FakeKnowledgeSourceRepository implements KnowledgeSourceRepository {
  readonly sources = new Map<string, KnowledgeSource>();

  async findById(id: KnowledgeSourceId): Promise<KnowledgeSource | undefined> {
    return this.sources.get(id);
  }

  async findByDocument(
    tenantId: TenantId,
    workspaceId: string,
    documentId: string,
  ): Promise<KnowledgeSource | undefined> {
    for (const source of this.sources.values()) {
      if (
        source.tenantId === tenantId &&
        source.workspaceId === workspaceId &&
        source.documentId === documentId
      ) {
        return source;
      }
    }
    return undefined;
  }

  async listByWorkspace(
    tenantId: TenantId,
    workspaceId: string,
    limit?: number,
  ): Promise<readonly KnowledgeSource[]> {
    return [...this.sources.values()]
      .filter((source) => source.tenantId === tenantId && source.workspaceId === workspaceId)
      .sort((a, b) => b.indexedAt.localeCompare(a.indexedAt))
      .slice(0, limit ?? 100);
  }

  async save(source: KnowledgeSource): Promise<void> {
    this.sources.set(source.id, source);
  }

  async removeByDocument(
    tenantId: TenantId,
    workspaceId: string,
    documentId: string,
  ): Promise<void> {
    for (const [id, source] of this.sources) {
      if (
        source.tenantId === tenantId &&
        source.workspaceId === workspaceId &&
        source.documentId === documentId
      ) {
        this.sources.delete(id);
      }
    }
  }
}

/** An in-memory {@link KnowledgeArticleRepository}. */
export class FakeKnowledgeArticleRepository implements KnowledgeArticleRepository {
  readonly articles = new Map<string, KnowledgeArticle>();

  async findById(id: KnowledgeArticleId): Promise<KnowledgeArticle | undefined> {
    return this.articles.get(id);
  }

  async listByWorkspace(
    tenantId: TenantId,
    workspaceId: string,
  ): Promise<readonly KnowledgeArticle[]> {
    return [...this.articles.values()]
      .filter((article) => article.tenantId === tenantId && article.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async save(article: KnowledgeArticle): Promise<void> {
    this.articles.set(article.id, article);
  }
}

/** An in-memory {@link KnowledgeCategoryRepository}. */
export class FakeKnowledgeCategoryRepository implements KnowledgeCategoryRepository {
  readonly categories = new Map<string, KnowledgeCategory>();

  async findById(id: KnowledgeCategoryId): Promise<KnowledgeCategory | undefined> {
    return this.categories.get(id);
  }

  async listByWorkspace(
    tenantId: TenantId,
    workspaceId: string,
  ): Promise<readonly KnowledgeCategory[]> {
    return [...this.categories.values()]
      .filter((category) => category.tenantId === tenantId && category.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async existsByName(tenantId: TenantId, workspaceId: string, name: string): Promise<boolean> {
    return [...this.categories.values()].some(
      (category) =>
        category.tenantId === tenantId &&
        category.workspaceId === workspaceId &&
        category.name === name,
    );
  }

  async save(category: KnowledgeCategory): Promise<void> {
    this.categories.set(category.id, category);
  }
}

/** An in-memory {@link EmployeeRepository}. */
export class FakeEmployeeRepository implements EmployeeRepository {
  readonly employees = new Map<string, Employee>();

  async findById(id: Employee['id']): Promise<Employee | undefined> {
    return this.employees.get(id);
  }

  async findByName(organizationId: TenantId, name: string): Promise<readonly Employee[]> {
    const term = name.trim().toLowerCase();
    return [...this.employees.values()].filter(
      (employee) =>
        employee.organizationId === organizationId &&
        employee.name.value.toLowerCase().includes(term),
    );
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly Employee[]> {
    return [...this.employees.values()].filter(
      (employee) => employee.organizationId === organizationId,
    );
  }

  async save(employee: Employee): Promise<void> {
    this.employees.set(employee.id, employee);
  }
}

/** An in-memory {@link CalendarEntryRepository}. */
export class FakeCalendarEntryRepository implements CalendarEntryRepository {
  readonly entries = new Map<string, CalendarEntry>();

  async findById(id: CalendarEntry['id']): Promise<CalendarEntry | undefined> {
    return this.entries.get(id);
  }

  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: string,
  ): Promise<readonly CalendarEntry[]> {
    return [...this.entries.values()]
      .filter(
        (entry) => entry.organizationId === organizationId && entry.workspaceId === workspaceId,
      )
      .sort((a, b) => b.timeWindow.startsAt.localeCompare(a.timeWindow.startsAt));
  }

  async save(entry: CalendarEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }
}

/** An in-memory {@link WorkflowInstanceRepository}. */
export class FakeWorkflowInstanceRepository implements WorkflowInstanceRepository {
  readonly instances = new Map<string, WorkflowInstance>();

  async findById(id: string): Promise<WorkflowInstance | undefined> {
    return this.instances.get(id);
  }

  async listByTenant(tenantId: TenantId, limit?: number): Promise<readonly WorkflowInstance[]> {
    return [...this.instances.values()]
      .filter((instance) => instance.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit ?? 100);
  }

  async save(instance: WorkflowInstance): Promise<void> {
    this.instances.set(instance.id, instance);
  }
}

/** An in-memory {@link WorkflowStepExecutionRepository}. */
export class FakeWorkflowStepExecutionRepository implements WorkflowStepExecutionRepository {
  readonly executions = new Map<string, WorkflowStepExecution>();

  async findById(id: string): Promise<WorkflowStepExecution | undefined> {
    return this.executions.get(id);
  }

  async findByWorkflowAndStep(
    workflowId: string,
    stepId: string,
  ): Promise<WorkflowStepExecution | undefined> {
    return [...this.executions.values()]
      .filter((execution) => execution.workflowId === workflowId && execution.stepId === stepId)
      .sort((a, b) => b.attempt - a.attempt)[0];
  }

  async listByWorkflow(workflowId: string): Promise<readonly WorkflowStepExecution[]> {
    return [...this.executions.values()]
      .filter((execution) => execution.workflowId === workflowId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listByTenant(tenantId: TenantId): Promise<readonly WorkflowStepExecution[]> {
    return [...this.executions.values()].filter((execution) => execution.tenantId === tenantId);
  }

  async save(execution: WorkflowStepExecution): Promise<void> {
    this.executions.set(execution.id, execution);
  }
}

/** An in-memory {@link NotificationRepository}. */
export class FakeNotificationRepository implements NotificationRepository {
  readonly notifications = new Map<string, Notification>();

  async save(notification: Notification): Promise<void> {
    this.notifications.set(notification.id, notification);
  }

  async findByIdAndRecipient(
    notificationId: string,
    recipientId: UserId,
    tenantId: TenantId,
  ): Promise<Notification | undefined> {
    for (const notification of this.notifications.values()) {
      if (
        notification.id === notificationId &&
        notification.recipientId === recipientId &&
        notification.tenantId === tenantId
      ) {
        return notification;
      }
    }
    return undefined;
  }

  async findBySourceEvent(
    sourceEventId: string,
    recipientId: UserId,
    tenantId: TenantId,
  ): Promise<Notification | undefined> {
    for (const notification of this.notifications.values()) {
      if (
        notification.sourceEventId === sourceEventId &&
        notification.recipientId === recipientId &&
        notification.tenantId === tenantId
      ) {
        return notification;
      }
    }
    return undefined;
  }

  async listByRecipient(
    recipientId: UserId,
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId; limit?: number },
  ): Promise<readonly Notification[]> {
    return [...this.notifications.values()]
      .filter((notification) => {
        const scoped =
          notification.recipientId === recipientId && notification.tenantId === tenantId;
        if (options?.workspaceId !== undefined) {
          return scoped && notification.workspaceId === options.workspaceId;
        }
        return scoped;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, options?.limit ?? 100);
  }

  async countUnread(
    recipientId: UserId,
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId },
  ): Promise<number> {
    const list = await this.listByRecipient(recipientId, tenantId, options);
    return list.filter((notification) => notification.status === 'unread').length;
  }

  async markRead(
    notificationId: string,
    recipientId: UserId,
    tenantId: TenantId,
    now: string,
  ): Promise<boolean> {
    const existing = await this.findByIdAndRecipient(notificationId, recipientId, tenantId);
    if (existing === undefined) {
      return false;
    }
    const result = existing.markRead(now);
    if (!result.ok) {
      return false;
    }
    await this.save(result.notification);
    return true;
  }

  async markAllRead(
    recipientId: UserId,
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId },
  ): Promise<number> {
    const list = await this.listByRecipient(recipientId, tenantId, options);
    let marked = 0;
    for (const notification of list) {
      if (notification.status !== 'unread') {
        continue;
      }
      const result = notification.markRead(new Date().toISOString());
      if (result.ok) {
        await this.save(result.notification);
        marked += 1;
      }
    }
    return marked;
  }
}

/** An in-memory {@link NotificationPreferencesRepository}. */
export class FakeNotificationPreferencesRepository implements NotificationPreferencesRepository {
  readonly preferences = new Map<string, NotificationPreferences>();

  async findByUser(
    userId: UserId,
    tenantId: TenantId,
  ): Promise<NotificationPreferences | undefined> {
    for (const preferences of this.preferences.values()) {
      if (preferences.userId === userId && preferences.tenantId === tenantId) {
        return preferences;
      }
    }
    return undefined;
  }

  async save(preferences: NotificationPreferences): Promise<void> {
    this.preferences.set(preferences.id, preferences);
  }
}

/** An in-memory {@link ActivityRepository}. */
export class FakeActivityRepository implements ActivityRepository {
  readonly items = new Map<string, ActivityItem>();

  async save(item: ActivityItem): Promise<void> {
    this.items.set(item.id, item);
  }

  async findBySourceEvent(
    sourceEventId: string,
    tenantId: TenantId,
  ): Promise<ActivityItem | undefined> {
    for (const item of this.items.values()) {
      if (item.sourceEventId === sourceEventId && item.tenantId === tenantId) {
        return item;
      }
    }
    return undefined;
  }

  async listByWorkspace(
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId; limit?: number },
  ): Promise<readonly ActivityItem[]> {
    return [...this.items.values()]
      .filter((item) => {
        const scoped = item.tenantId === tenantId;
        if (options?.workspaceId !== undefined) {
          return scoped && item.workspaceId === options.workspaceId;
        }
        return scoped;
      })
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, options?.limit ?? 100);
  }
}

/** An in-memory {@link ResourceAssignmentRepository}. */
export class FakeResourceAssignmentRepository implements ResourceAssignmentRepository {
  readonly assignments = new Map<string, ResourceAssignment>();

  async findById(id: AssignmentId): Promise<ResourceAssignment | undefined> {
    return this.assignments.get(id);
  }

  async findByProjectAndEmployee(
    projectId: ProjectId,
    employeeId: string,
  ): Promise<ResourceAssignment | undefined> {
    for (const assignment of this.assignments.values()) {
      if (assignment.projectId === projectId && assignment.employeeId === employeeId) {
        return assignment;
      }
    }
    return undefined;
  }

  async listByProject(projectId: ProjectId): Promise<readonly ResourceAssignment[]> {
    return [...this.assignments.values()].filter(
      (assignment) => assignment.projectId === projectId,
    );
  }

  async save(assignment: ResourceAssignment): Promise<void> {
    this.assignments.set(assignment.id, assignment);
  }
}

/** An in-memory {@link WorkspaceMembershipRepository}. */
export class FakeWorkspaceMembershipRepository implements WorkspaceMembershipRepository {
  readonly memberships = new Map<string, WorkspaceMembership>();

  async findById(id: string): Promise<WorkspaceMembership | undefined> {
    return this.memberships.get(id);
  }

  async findByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<WorkspaceMembership | undefined> {
    for (const membership of this.memberships.values()) {
      if (membership.workspaceId === workspaceId && membership.userId === userId) {
        return membership;
      }
    }
    return undefined;
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly WorkspaceMembership[]> {
    return [...this.memberships.values()].filter(
      (membership) => membership.workspaceId === workspaceId,
    );
  }

  async listByUser(userId: UserId): Promise<readonly WorkspaceMembership[]> {
    return [...this.memberships.values()].filter((membership) => membership.userId === userId);
  }

  async countOwners(workspaceId: WorkspaceId): Promise<number> {
    return (await this.listByWorkspace(workspaceId)).filter((membership) => membership.isOwner())
      .length;
  }

  async save(membership: WorkspaceMembership): Promise<void> {
    this.memberships.set(membership.id, membership);
  }

  async remove(membership: WorkspaceMembership): Promise<void> {
    this.memberships.delete(membership.id);
  }
}

/** An in-memory {@link WorkspaceInstallationRepository} (unused in v1). */
export class FakeWorkspaceInstallationRepository implements WorkspaceInstallationRepository {
  readonly installations = new Map<string, WorkspaceInstallation>();

  async findById(id: string): Promise<WorkspaceInstallation | undefined> {
    return this.installations.get(id);
  }

  async findByWorkspaceAndPlugin(
    _workspaceId: WorkspaceId,
    _pluginId: string,
  ): Promise<WorkspaceInstallation | undefined> {
    return undefined;
  }

  async listByWorkspace(_workspaceId: WorkspaceId): Promise<readonly WorkspaceInstallation[]> {
    return [];
  }

  async save(installation: WorkspaceInstallation): Promise<void> {
    this.installations.set(installation.id, installation);
  }

  async remove(installation: WorkspaceInstallation): Promise<void> {
    this.installations.delete(installation.id);
  }
}

/** A test hasher (never use in production). */
export class TestPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<PasswordHash> {
    return PasswordHash.create('scrypt', `test:${plain}`);
  }

  async verify(plain: string, hash: PasswordHash): Promise<boolean> {
    return hash.hash === `test:${plain}`;
  }
}

/** A {@link OidcGateway} that authenticates a fixed test identity. */
export class FakeOidcGateway implements OidcGateway {
  readonly exchangedStates: string[] = [];
  readonly exchangedVerifiers: string[] = [];
  readonly identity: OidcIdentity;

  constructor(
    identity: OidcIdentity = {
      subject: 'sub-alex-123',
      email: 'alex@nexora.dev',
      emailVerified: true,
      displayName: 'Alex Morgan',
      issuer: 'http://keycloak.test/realms/nexora',
    },
  ) {
    this.identity = identity;
  }

  async buildAuthorizationUrl(state: string, pkce: PkceParameters): Promise<string> {
    return `http://keycloak.test/realms/nexora/protocol/openid-connect/auth?state=${state}&code_challenge=${pkce.codeChallenge}&code_challenge_method=S256`;
  }

  async exchangeCode(
    _params: OidcCallbackParams,
    expectedState: string,
    codeVerifier: string,
  ): Promise<OidcIdentity> {
    this.exchangedStates.push(expectedState);
    this.exchangedVerifiers.push(codeVerifier);
    return this.identity;
  }

  async buildLogoutUrl(redirectTo: string): Promise<string> {
    return `http://keycloak.test/realms/nexora/protocol/openid-connect/logout?post_logout_redirect_uri=${encodeURIComponent(redirectTo)}`;
  }
}
