/**
 * @nexora/persistence — Drizzle schema.
 *
 * One table per aggregate root (PERSISTENCE.md §4 aggregate ownership).
 * Child entities are stored as JSONB documents (PERSISTENCE.md §2.2
 * document classes): the aggregate is the transaction boundary, so
 * child state is written and read atomically with the root. Identity and
 * lifecycle columns (id, status, version, timestamps) stay relational so
 * the repository ports (`findBySlug`, `countOwners`, ...) query cheaply.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * users — the {@link @nexora/domain-identity!User} aggregate.
 * Roles are stored as a JSONB array of role-name references.
 */
export const users = pgTable(
  'users',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    username: varchar('username', { length: 64 }).notNull(),
    passwordAlgorithm: varchar('password_algorithm', { length: 16 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    profile: jsonb('profile').notNull(),
    roles: jsonb('roles').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    uniqueIndex('users_username_unique').on(table.username),
    uniqueIndex('users_tenant_email_unique').on(table.tenantId, table.email),
    uniqueIndex('users_tenant_username_unique').on(table.tenantId, table.username),
  ],
);

/**
 * sessions — the {@link @nexora/domain-identity!Session} aggregate.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    token: varchar('token', { length: 128 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  },
  (table) => [uniqueIndex('sessions_token_unique').on(table.token)],
);

/**
 * roles — the {@link @nexora/domain-identity!Role} aggregate.
 * Permissions are stored as a JSONB array of {name, scopes}.
 * Role names are unique per tenant; `tenant_id` is NULL for
 * platform-global role templates (PSD.md §10).
 */
export const roles = pgTable(
  'roles',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }),
    name: varchar('name', { length: 128 }).notNull(),
    level: varchar('level', { length: 32 }).notNull(),
    approver: boolean('approver').notNull().default(false),
    description: text('description'),
    permissions: jsonb('permissions').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    // Composite: unique per tenant (NULLs are distinct in Postgres unique
    // indexes, so platform-global roles need the partial index below).
    uniqueIndex('roles_name_tenant_unique').on(table.tenantId, table.name),
    // Platform-global roles (tenant_id IS NULL) stay name-unique among
    // themselves (PSD.md §10 role name uniqueness).
    uniqueIndex('roles_name_platform_unique')
      .on(table.name)
      .where(sql`${table.tenantId} IS NULL`),
  ],
);

/**
 * organizations — the {@link @nexora/domain-organizations!Organization}
 * aggregate. Profile and settings children are JSONB documents; the id is
 * the tenant id.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    profile: jsonb('profile').notNull(),
    settings: jsonb('settings').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [uniqueIndex('organizations_slug_unique').on(table.slug)],
);

/**
 * organization_memberships — the
 * {@link @nexora/domain-organizations!OrganizationMembership} aggregate.
 */
export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    role: varchar('role', { length: 32 }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [uniqueIndex('org_membership_org_user_unique').on(table.organizationId, table.userId)],
);

/**
 * workspaces — the {@link @nexora/domain-workspaces!Workspace} aggregate.
 * All child entities (settings, branding, preferences, features, bindings)
 * are JSONB documents written atomically with the root.
 */
export const workspaces = pgTable(
  'workspaces',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    visibility: varchar('visibility', { length: 32 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    settings: jsonb('settings').notNull(),
    branding: jsonb('branding').notNull(),
    preferences: jsonb('preferences').notNull(),
    features: jsonb('features').notNull().default([]),
    agentBindings: jsonb('agent_bindings').notNull().default([]),
    knowledgeBindings: jsonb('knowledge_bindings').notNull().default([]),
    workflowBindings: jsonb('workflow_bindings').notNull().default([]),
    searchBinding: jsonb('search_binding'),
    notificationBinding: jsonb('notification_binding'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [uniqueIndex('workspaces_org_slug_unique').on(table.organizationId, table.slug)],
);

/**
 * workspace_memberships — the
 * {@link @nexora/domain-workspaces!WorkspaceMembership} aggregate.
 */
export const workspaceMemberships = pgTable(
  'workspace_memberships',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    role: varchar('role', { length: 32 }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [uniqueIndex('ws_membership_ws_user_unique').on(table.workspaceId, table.userId)],
);

/**
 * workspace_installations — the
 * {@link @nexora/domain-workspaces!WorkspaceInstallation} aggregate.
 */
export const workspaceInstallations = pgTable(
  'workspace_installations',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    pluginId: varchar('plugin_id', { length: 128 }).notNull(),
    pluginVersion: varchar('plugin_version', { length: 32 }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [uniqueIndex('ws_install_ws_plugin_unique').on(table.workspaceId, table.pluginId)],
);

/**
 * employees — the {@link @nexora/domain-hr!Employee} aggregate.
 * One row per employee; the organization id is the tenant scope.
 */
export const employees = pgTable(
  'employees',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [index('employees_org_idx').on(table.organizationId)],
);

/**
 * resource_assignments — the
 * {@link @nexora/domain-projects!ResourceAssignment} aggregate.
 * Links a project (Projects BC) to an employee id (HR BC reference, AP-13:
 * aggregates never hold object graphs of other aggregates).
 */
export const resourceAssignments = pgTable(
  'resource_assignments',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    projectId: varchar('project_id', { length: 64 }).notNull(),
    employeeId: varchar('employee_id', { length: 64 }).notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('resource_assignments_org_idx').on(table.organizationId),
    index('resource_assignments_project_idx').on(table.projectId),
    uniqueIndex('resource_assignments_project_employee_unique').on(
      table.projectId,
      table.employeeId,
    ),
  ],
);

/**
 * projects — the {@link @nexora/domain-projects!Project} aggregate.
 * One row per project; the optional description is a nullable text column.
 */
export const projects = pgTable(
  'projects',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [index('projects_org_idx').on(table.organizationId)],
);

/**
 * conversations — the AI Runtime conversation aggregate (AIR.md §8, R13).
 * The conversation is the transaction boundary: turns are stored as a JSONB
 * array written atomically with the root (PERSISTENCE.md §2.2). Stored per
 * tenant and user; workspace-scoped conversations carry the workspace id.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }),
    turns: jsonb('turns').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('conversations_tenant_user_idx').on(table.tenantId, table.userId)],
);

/**
 * workflow_instances — the {@link @nexora/module-workflow!WorkflowInstance}
 * aggregate. One row per workflow run; the tenant id is the isolation scope
 * (every read is tenant-filtered). Input/state/output are JSONB documents;
 * lifecycle columns stay relational for cheap status queries.
 */
export const workflowInstances = pgTable(
  'workflow_instances',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    definitionId: varchar('definition_id', { length: 64 }).notNull(),
    definitionKey: varchar('definition_key', { length: 128 }).notNull(),
    definitionVersion: integer('definition_version').notNull().default(1),
    userId: varchar('user_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    input: jsonb('input').notNull(),
    state: jsonb('state').notNull().default({}),
    output: jsonb('output'),
    error: text('error'),
    currentStepId: varchar('current_step_id', { length: 64 }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [index('workflow_instances_tenant_idx').on(table.tenantId)],
);

/**
 * documents — the {@link @nexora/domain-documents!Document} aggregate.
 * METADATA ONLY: the binary content lives behind the application-layer
 * storage port (PERSISTENCE.md §2 multi-model) — the `content_ref` is the
 * opaque storage key, never the bytes. The organization id is the tenant
 * scope and the workspace id is the workspace scope; every read is scoped.
 */
export const documents = pgTable(
  'documents',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    uploaderId: varchar('uploader_id', { length: 64 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    contentType: varchar('content_type', { length: 64 }).notNull(),
    contentRef: varchar('content_ref', { length: 256 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    failureReason: text('failure_reason'),
    contentVersion: integer('content_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('documents_org_idx').on(table.organizationId),
    index('documents_workspace_idx').on(table.workspaceId, table.createdAt),
  ],
);

/**
 * knowledge_sources — the {@link @nexora/domain-knowledge!KnowledgeSource}
 * aggregate AND the persisted search projection (DOMAIN_MODEL.md Search
 * IndexEntry). One row per indexed document within a scope; re-indexing a
 * document version UPSERTS the row (stale entries never answer).
 */
export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    documentId: varchar('document_id', { length: 64 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    text: text('text').notNull(),
    version: integer('version').notNull().default(1),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('knowledge_sources_tenant_idx').on(table.tenantId, table.workspaceId),
    uniqueIndex('knowledge_sources_document_unique').on(
      table.tenantId,
      table.workspaceId,
      table.documentId,
    ),
  ],
);

/**
 * notifications — the {@link @nexora/module-notifications!Notification}
 * aggregate. One row per recipient-scoped notification; the recipient id is
 * ALWAYS the trusted server-derived event actor (never client/payload). The
 * unique (tenant, source_event, recipient) index is the idempotency key — a
 * duplicate event delivery can never create a duplicate notification.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    recipientId: varchar('recipient_id', { length: 64 }).notNull(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }),
    type: varchar('type', { length: 128 }).notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    priority: varchar('priority', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('unread'),
    action: jsonb('action'),
    sourceEventId: varchar('source_event_id', { length: 128 }).notNull(),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('notifications_recipient_idx').on(table.tenantId, table.recipientId, table.createdAt),
    uniqueIndex('notifications_source_recipient_unique').on(
      table.tenantId,
      table.sourceEventId,
      table.recipientId,
    ),
  ],
);

/**
 * notification_preferences — the
 * {@link @nexora/module-notifications!NotificationPreferences} aggregate.
 * One row per (user, tenant); categories are a JSONB enabled-map. Defaults
 * are safe (all enabled) and live in the aggregate, not the schema.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    categories: jsonb('categories').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('notification_prefs_user_tenant_unique').on(table.userId, table.tenantId),
  ],
);

/**
 * activity_items — the {@link @nexora/module-notifications!ActivityItem}
 * read model. A disposable, rebuildable projection of the canonical event
 * stream (never a second source of truth). Workspace-scoped where the
 * source event is workspace-scoped; the unique (tenant, source_event) index
 * is the idempotency key for the projection.
 */
export const activityItems = pgTable(
  'activity_items',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }),
    type: varchar('type', { length: 128 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    actorId: varchar('actor_id', { length: 64 }),
    sourceEventId: varchar('source_event_id', { length: 128 }).notNull(),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('activity_items_workspace_idx').on(table.tenantId, table.workspaceId, table.occurredAt),
    uniqueIndex('activity_items_source_unique').on(table.tenantId, table.sourceEventId),
  ],
);

/**
 * workflow_step_executions — the
 * {@link @nexora/module-workflow!WorkflowStepExecution} journal. One row per
 * (workflow, step, attempt); the unique `execution_key` is the idempotency
 * identity — a duplicate delivery can never create a second mutation.
 */
export const workflowStepExecutions = pgTable(
  'workflow_step_executions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    workflowId: varchar('workflow_id', { length: 64 }).notNull(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    stepId: varchar('step_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    capabilityId: varchar('capability_id', { length: 128 }).notNull(),
    toolId: varchar('tool_id', { length: 128 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    attempt: integer('attempt').notNull().default(0),
    executionKey: varchar('execution_key', { length: 256 }).notNull(),
    input: jsonb('input').notNull(),
    output: jsonb('output'),
    error: text('error'),
    approvalId: varchar('approval_id', { length: 64 }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('workflow_step_exec_workflow_idx').on(table.workflowId),
    index('workflow_step_exec_tenant_idx').on(table.tenantId),
    uniqueIndex('workflow_step_exec_key_unique').on(table.executionKey),
  ],
);

/**
 * calendar_events — the {@link @nexora/module-calendar!CalendarEntry}
 * aggregate. One row per calendar entry; the organization id is the tenant
 * scope and the workspace id is the workspace scope — every read is scoped
 * (a foreign or cross-workspace entry id resolves to NOT FOUND, never to
 * another workspace's entry). The time window is stored as two relational
 * timestamps so list queries can sort/scan by start cheaply.
 */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('calendar_events_org_idx').on(table.organizationId),
    index('calendar_events_workspace_idx').on(table.workspaceId, table.startsAt),
  ],
);
