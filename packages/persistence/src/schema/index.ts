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
import { desc } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
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
    // External OIDC identity binding (AUTH-009). Nullable: existing users stay
    // unbound until their next successful OIDC login. Authentication-internal.
    oidcIssuer: varchar('oidc_issuer', { length: 512 }),
    oidcSubject: varchar('oidc_subject', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    // One account per external identity; multiple unbound (NULL) users coexist.
    uniqueIndex('users_oidc_identity_unique')
      .on(table.oidcIssuer, table.oidcSubject)
      .where(sql`${table.oidcIssuer} IS NOT NULL AND ${table.oidcSubject} IS NOT NULL`),
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
    // SHA-256 hex digest of the bearer token (AUTH-004). The raw token is never stored.
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  },
  (table) => [uniqueIndex('sessions_token_hash_unique').on(table.tokenHash)],
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
  (table) => [
    uniqueIndex('org_membership_org_user_unique').on(table.organizationId, table.userId),
    // S22: user-leading index — the per-request authorization read resolves
    // the caller's organizations by user_id on EVERY protected request.
    index('org_membership_user_idx').on(table.userId),
  ],
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
  (table) => [
    uniqueIndex('ws_membership_ws_user_unique').on(table.workspaceId, table.userId),
    // S22: user-leading index — the per-request authorization read resolves
    // the caller's workspace memberships by user_id on every protected
    // request (was a full table scan).
    index('ws_membership_user_idx').on(table.userId),
  ],
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
    // Employment details captured when a person is hired through recruiting
    // (all nullable: records created before recruiting carry a name only).
    email: varchar('email', { length: 254 }),
    jobTitle: varchar('job_title', { length: 120 }),
    department: varchar('department', { length: 80 }),
    employmentType: varchar('employment_type', { length: 32 }),
    startDate: varchar('start_date', { length: 10 }),
    requisitionId: varchar('requisition_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [index('employees_org_idx').on(table.organizationId)],
);

/**
 * hiring_requisitions — the {@link @nexora/domain-hr!HiringRequisition}
 * aggregate: a team's request to hire, with its decision chain. The
 * organization id is the tenant scope; `workspace_id` is the team it was
 * raised from. `history` is the append-only trail (who did what, when);
 * `version` guards every update (optimistic concurrency).
 */
export const hiringRequisitions = pgTable(
  'hiring_requisitions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    requestedBy: varchar('requested_by', { length: 64 }).notNull(),
    jobTitle: varchar('job_title', { length: 120 }).notNull(),
    department: varchar('department', { length: 80 }).notNull(),
    projectId: varchar('project_id', { length: 64 }),
    headcount: integer('headcount').notNull(),
    employmentType: varchar('employment_type', { length: 32 }).notNull(),
    salaryMinMinorUnits: bigint('salary_min_minor_units', { mode: 'number' }).notNull(),
    salaryMaxMinorUnits: bigint('salary_max_minor_units', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    justification: text('justification').notNull(),
    urgency: varchar('urgency', { length: 16 }).notNull(),
    targetStartDate: varchar('target_start_date', { length: 10 }),
    status: varchar('status', { length: 32 }).notNull(),
    round: integer('round').notNull().default(1),
    history: jsonb('history').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('hiring_requisitions_org_idx').on(table.organizationId, table.createdAt),
    index('hiring_requisitions_requester_idx').on(table.organizationId, table.requestedBy),
  ],
);

/**
 * job_openings — the {@link @nexora/domain-hr!JobOpening} aggregate: the
 * position HR opens for an approved hiring request (exactly one per request).
 * `offers_out` + `hired_count` never exceed `headcount`.
 */
export const jobOpenings = pgTable(
  'job_openings',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    requisitionId: varchar('requisition_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    hiringManagerId: varchar('hiring_manager_id', { length: 64 }).notNull(),
    openedBy: varchar('opened_by', { length: 64 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    department: varchar('department', { length: 80 }).notNull(),
    headcount: integer('headcount').notNull(),
    employmentType: varchar('employment_type', { length: 32 }).notNull(),
    salaryMinMinorUnits: bigint('salary_min_minor_units', { mode: 'number' }).notNull(),
    salaryMaxMinorUnits: bigint('salary_max_minor_units', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    description: text('description').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    offersOut: integer('offers_out').notNull().default(0),
    hiredCount: integer('hired_count').notNull().default(0),
    closedReason: varchar('closed_reason', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('job_openings_org_idx').on(table.organizationId, table.createdAt),
    // One opening per hiring request: a duplicate "open position" cannot be created.
    uniqueIndex('job_openings_requisition_unique').on(table.organizationId, table.requisitionId),
  ],
);

/**
 * candidates — the {@link @nexora/domain-hr!Candidate} aggregate: one person
 * considered for one opening. `feedback`, `offer` and `history` are owned by
 * the aggregate; `version` guards every update.
 */
export const candidates = pgTable(
  'candidates',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    openingId: varchar('opening_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    phone: varchar('phone', { length: 40 }),
    source: varchar('source', { length: 32 }).notNull(),
    resumeNotes: text('resume_notes'),
    stage: varchar('stage', { length: 32 }).notNull(),
    feedback: jsonb('feedback').notNull(),
    offer: jsonb('offer'),
    closedReason: varchar('closed_reason', { length: 500 }),
    employeeId: varchar('employee_id', { length: 64 }),
    history: jsonb('history').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [index('candidates_opening_idx').on(table.organizationId, table.openingId)],
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
    // Prompt 4: the execution origin + the agent principal / delegation /
    // approval a workflow ran under (never collapsed into `user_id`).
    origin: varchar('origin', { length: 32 }),
    agentId: varchar('agent_id', { length: 64 }),
    delegationId: varchar('delegation_id', { length: 64 }),
    approvalId: varchar('approval_id', { length: 64 }),
    // Prompt 8: the initiating run's RBAC capability ceiling — bounds every
    // inner step and compensation (null = no ceiling was bound).
    allowedCapabilityIds: jsonb('allowed_capability_ids'),
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
 * document_versions — the {@link @nexora/domain-documents!DocumentVersion}
 * aggregate (S17 version history). An IMMUTABLE append-only log of a
 * document's content revisions: one row per revision, never updated once
 * written (restore copies content forward into a NEW revision — history is
 * never mutated). The unique (document_id, version) constraint is the
 * monotonicity defense; the organization/workspace ids are the trusted
 * scope columns, and every read goes through the owning document (whose
 * scope the caller verifies first).
 */
export const documentVersions = pgTable(
  'document_versions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    documentId: varchar('document_id', { length: 64 }).notNull(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    version: integer('version').notNull(),
    contentRef: varchar('content_ref', { length: 256 }).notNull(),
    contentType: varchar('content_type', { length: 64 }).notNull(),
    restoredFromVersion: integer('restored_from_version'),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('document_versions_document_idx').on(table.documentId),
    uniqueIndex('document_versions_document_version_unique').on(table.documentId, table.version),
  ],
);

/**
 * document_templates — the
 * {@link @nexora/domain-documents!DocumentTemplate} aggregate (S17
 * templates). One row per template; the organization id is the tenant scope
 * and the workspace id is the workspace scope — every read is scoped (the
 * picker lists ACTIVE templates of the trusted workspace only). Metadata is
 * relational; starter content lives behind the storage port.
 */
export const documentTemplates = pgTable(
  'document_templates',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    contentType: varchar('content_type', { length: 64 }).notNull(),
    contentRef: varchar('content_ref', { length: 256 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('document_templates_org_idx').on(table.organizationId),
    index('document_templates_workspace_idx').on(table.workspaceId),
  ],
);

/**
 * knowledge_sources — the {@link @nexora/domain-knowledge!KnowledgeSource}
 * aggregate AND the persisted search projection (DOMAIN_MODEL.md Search
 * IndexEntry). One row per indexed document OR published KB article within a
 * scope; re-indexing a version UPSERTS the row (stale entries never answer).
 * The `kind` discriminates the corpus member (`document` | `article`, S18);
 * `document_id` is the generic scope reference (the document id for
 * documents, the article id for articles). Existing S17 document rows keep
 * `kind = 'document'` (the backward-compatible default).
 */
export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    documentId: varchar('document_id', { length: 64 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull().default('document'),
    title: varchar('title', { length: 200 }).notNull(),
    text: text('text').notNull(),
    version: integer('version').notNull().default(1),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // S22 search/index warm-up: the tenant+workspace scope index now also
    // serves the search ORDER BY (indexed_at DESC) — the p95 < 300 ms
    // search window no longer pays an explicit sort at volume.
    index('knowledge_sources_tenant_idx').on(
      table.tenantId,
      table.workspaceId,
      desc(table.indexedAt),
    ),
    uniqueIndex('knowledge_sources_document_unique').on(
      table.tenantId,
      table.workspaceId,
      table.documentId,
    ),
  ],
);

/**
 * knowledge_articles — the {@link @nexora/domain-knowledge!KnowledgeArticle}
 * aggregate (S18 Knowledge Base). One row per article; the tenant + workspace
 * are the immutable isolation scope. The article is the AUTHORITATIVE source
 * of its own text content (the search corpus entry is a projection of the
 * PUBLISHED article only). `category_id` is an optional, workspace-scoped
 * reference (flat model: one category per article, no hierarchy).
 */
export const knowledgeArticles = pgTable(
  'knowledge_articles',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    categoryId: varchar('category_id', { length: 64 }),
    status: varchar('status', { length: 32 }).notNull(),
    contentVersion: integer('content_version').notNull().default(1),
    author: varchar('author', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('knowledge_articles_tenant_idx').on(table.tenantId, table.workspaceId),
    index('knowledge_articles_category_idx').on(table.categoryId),
  ],
);

/**
 * knowledge_categories — the {@link @nexora/domain-knowledge!KnowledgeCategory}
 * aggregate (S18 Knowledge Base). A flat, workspace-scoped category; the
 * tenant + workspace are the immutable isolation scope. No nesting and no
 * many-to-many in v1 — an article references at most one category.
 */
export const knowledgeCategories = pgTable(
  'knowledge_categories',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('knowledge_categories_tenant_idx').on(table.tenantId, table.workspaceId),
    uniqueIndex('knowledge_categories_scope_name_unique').on(
      table.tenantId,
      table.workspaceId,
      table.name,
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
 * webhook_endpoints — the
 * {@link @nexora/module-integrations!WebhookEndpoint} aggregate (S20
 * webhooks out). One row per workspace webhook endpoint. The organization
 * id is the tenant scope and the workspace id is the workspace scope —
 * every read is scoped. The `secret` (HMAC signing key) is persisted but
 * only ever surfaced once at creation; reads return a masked value.
 */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    secret: varchar('secret', { length: 128 }).notNull(),
    eventTypes: jsonb('event_types').notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [index('webhook_endpoints_workspace_idx').on(table.organizationId, table.workspaceId)],
);

/**
 * webhook_deliveries — the
 * {@link @nexora/module-integrations!WebhookDelivery} aggregate (S20
 * delivery receipts). An APPEND-ONLY audit log: one row per business event
 * delivered to a webhook endpoint, recording the terminal outcome and the
 * final attempt. Rows are never updated after creation.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    endpointId: varchar('endpoint_id', { length: 64 }).notNull(),
    eventId: varchar('event_id', { length: 128 }).notNull(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    attempt: integer('attempt').notNull().default(1),
    statusCode: integer('status_code'),
    error: text('error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('webhook_deliveries_endpoint_idx').on(
      table.organizationId,
      table.endpointId,
      table.deliveredAt,
    ),
  ],
);

/**
 * email_outbox — the {@link @nexora/module-integrations!EmailRecord}
 * outbox (S20 email notifications). An APPEND-ONLY record of every email
 * notification dispatched through the email channel; the unique
 * (tenant, source_event) index is the idempotency key — a duplicate event
 * delivery can never dispatch the same email twice.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }),
    recipientId: varchar('recipient_id', { length: 64 }).notNull(),
    recipientEmail: varchar('recipient_email', { length: 254 }).notNull(),
    subject: varchar('subject', { length: 200 }).notNull(),
    body: text('body').notNull(),
    sourceEventId: varchar('source_event_id', { length: 128 }).notNull(),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('email_outbox_tenant_idx').on(table.tenantId, table.recipientId, table.dispatchedAt),
    uniqueIndex('email_outbox_source_event_unique').on(table.tenantId, table.sourceEventId),
  ],
);

/**
 * inbound_messages — the S21 replay guard for the signed inbound email
 * endpoint. An APPEND-ONLY claim ledger: one row per accepted external
 * message id. The unique (tenant, message_id) index is the atomic
 * exactly-once guard — the first delivery of a message id wins the claim;
 * any replayed delivery of the same message id fails the insert and is
 * rejected without re-executing the routed action (S21 red-team finding
 * IN-01: the documented "dedupe by message id" contract was not enforced).
 */
export const inboundMessages = pgTable(
  'inbound_messages',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    messageId: varchar('message_id', { length: 254 }).notNull(),
    action: varchar('action', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 128 }).notNull(),
    handledAt: timestamp('handled_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('inbound_messages_tenant_idx').on(table.tenantId, table.handledAt),
    uniqueIndex('inbound_messages_message_unique').on(table.tenantId, table.messageId),
  ],
);

/**
 * approval_requests — the durable store behind the AI Runtime
 * `ApprovalEngine` port (S24 Phase 6). One row per approval request; the
 * tenant id is the isolation scope. The record preserves everything needed
 * to resume a governed action safely across process restarts: the tool id +
 * validated `input` (never identity — identity is the trusted relational
 * scope columns), the decision state, and the execution outcome.
 *
 * Exactly-once contract: `claim` is an atomic conditional transition
 * (`approved → executing`) so concurrent resume attempts across processes
 * can never both execute; the unique `(tenant_id, resume_key)` index is the
 * cross-process resume dedupe — a re-invocation of the same governed action
 * resolves to the SAME pending approval instead of opening a second one
 * (NULL resume keys — one-shot AI approvals — are distinct in Postgres
 * unique indexes, so the AI path is unaffected).
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }),
    conversationId: varchar('conversation_id', { length: 64 }).notNull(),
    runId: varchar('run_id', { length: 64 }).notNull(),
    stepId: varchar('step_id', { length: 64 }).notNull(),
    toolId: varchar('tool_id', { length: 128 }).notNull(),
    capabilityId: varchar('capability_id', { length: 128 }).notNull(),
    sideEffectClass: varchar('side_effect_class', { length: 32 }).notNull(),
    reason: text('reason').notNull(),
    intent: text('intent').notNull(),
    input: jsonb('input').notNull(),
    resumeKey: varchar('resume_key', { length: 128 }),
    // Prompt 4: the agent principal whose run opened the approval (and the
    // delegation that authorized the gated capability). A resumed approval
    // executes AS this agent — re-validated at execution time.
    agentId: varchar('agent_id', { length: 64 }),
    delegationId: varchar('delegation_id', { length: 64 }),
    // The policy decision the approval was opened under (Prompt 5): recorded,
    // never recomputed, so history stays true after a policy changes.
    policy: jsonb('policy'),
    status: varchar('status', { length: 32 }).notNull(),
    decision: varchar('decision', { length: 16 }),
    decisionReason: text('decision_reason'),
    decidedBy: varchar('decided_by', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    // Prompt 8: approval expiry + approver authority. NULL `expires_at` is a
    // legacy row (the row mapper treats it as created_at + 24h).
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    requiredApproverRoleId: varchar('required_approver_role_id', { length: 96 }),
    separationOfDuties: boolean('separation_of_duties').notNull().default(false),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    result: jsonb('result'),
    error: text('error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('approval_requests_tenant_idx').on(table.tenantId),
    index('approval_requests_conversation_idx').on(table.conversationId),
    index('approval_requests_user_idx').on(table.tenantId, table.userId),
    index('approval_requests_expiry_idx').on(table.tenantId, table.status, table.expiresAt),
    // Cross-process resume dedupe (S24 Phase 6): at most one pending
    // approval per (tenant, resumeKey). NULL resume keys (AI one-shot
    // approvals) are distinct and unaffected.
    uniqueIndex('approval_requests_resume_key_unique').on(table.tenantId, table.resumeKey),
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

/**
 * budgets — the {@link @nexora/module-finance!Budget} aggregate. One row per
 * budget; the organization id is the tenant scope and the workspace id is
 * the workspace scope — every read is scoped (a foreign or cross-workspace
 * budget id resolves to NOT FOUND, never to another workspace's budget).
 * Money is stored as an integer count of minor units (never floating point,
 * PERSISTENCE.md §6) alongside its currency code.
 */
export const budgets = pgTable(
  'budgets',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    // bigint: the domain allows up to 1e11 minor units, past int4's 2 147 483 647.
    allocatedMinorUnits: bigint('allocated_minor_units', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('budgets_org_idx').on(table.organizationId),
    index('budgets_workspace_idx').on(table.workspaceId, table.status),
  ],
);

/**
 * expenses — the {@link @nexora/module-finance!Expense} aggregate. One row
 * per expense claim; scoped the same way as `budgets`. `budgetId` is a
 * plain column (no DB-level foreign key — PERSISTENCE.md: one table per
 * aggregate root, cross-aggregate integrity is an application-layer
 * concern, the same convention every other table here follows), indexed so
 * the utilization projection can list a budget's approved expenses cheaply.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    budgetId: varchar('budget_id', { length: 64 }).notNull(),
    submittedBy: varchar('submitted_by', { length: 64 }).notNull(),
    description: varchar('description', { length: 120 }).notNull(),
    amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    decidedBy: varchar('decided_by', { length: 64 }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('expenses_org_idx').on(table.organizationId),
    index('expenses_workspace_idx').on(table.workspaceId, table.createdAt),
    index('expenses_budget_idx').on(table.budgetId, table.status),
  ],
);

/**
 * agent_executions — the durable journal of governed business-agent runs
 * (S26 Phase 8 measurements). One row per execution recorded by the agent
 * engine through the API-layer recorder; the tenant id is the isolation
 * scope and every read is scoped by it. Only trusted relational columns are
 * stored (identity/scope live in columns, never in payload), and the row
 * records the OUTCOME fact (status + run id + proposal link) — the minimal
 * measurement surface, never a second analytics subsystem.
 */
export const agentExecutions = pgTable(
  'agent_executions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }),
    // The agent DEFINITION id (engine configuration, e.g. `finance`).
    agentId: varchar('agent_id', { length: 64 }).notNull(),
    // Prompt 4: the agent IDENTITY (security principal, `agt_…`) that ran,
    // and the delegations that authorized it. Null for historical rows.
    agentIdentityId: varchar('agent_identity_id', { length: 64 }),
    delegationIds: jsonb('delegation_ids'),
    approvalId: varchar('approval_id', { length: 64 }),
    roleId: varchar('role_id', { length: 128 }).notNull(),
    domainId: varchar('domain_id', { length: 64 }).notNull(),
    proposalId: varchar('proposal_id', { length: 128 }),
    proposalAction: text('proposal_action'),
    status: varchar('status', { length: 32 }).notNull(),
    runId: varchar('run_id', { length: 64 }),
    reason: text('reason'),
    // Phase 10: the remediation linkage — which plan/step/problem this
    // execution belongs to (one journal, fully traceable problem → plan →
    // step → execution).
    planId: varchar('plan_id', { length: 64 }),
    stepId: varchar('step_id', { length: 64 }),
    problemId: varchar('problem_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('agent_executions_tenant_idx').on(table.tenantId),
    index('agent_executions_tenant_user_idx').on(table.tenantId, table.userId, table.createdAt),
    // Phase 10 traceability: plan-scoped journal reads (the remediation
    // console's "what happened" view).
    index('agent_executions_plan_idx').on(table.tenantId, table.planId),
  ],
);

/**
 * business_problems — the durable lifecycle record of detected business
 * problems (S27). One row per problem aggregate; the `correlation_id` is
 * the deterministic dedupe identity (signal + scope + entity) — repeated
 * detection scans update ONE row, never duplicates (S27 §15). The tenant
 * id is the isolation scope and the workspace id the workspace scope;
 * every read is scoped by both — a forged problem id from another
 * tenant/workspace resolves to nothing (fail closed).
 *
 * Evidence and solution candidates are NOT stored here: they are derived
 * projections recomputed deterministically at read time from the trusted
 * snapshot (existing application handlers) — storing them would duplicate
 * state the engine already owns (S27 §17 minimum persistence). Only the
 * lifecycle facts the engine must survive restarts with (status,
 * severity, identity, affected-entity references) are relational columns.
 */
export const businessProblems = pgTable(
  'business_problems',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    correlationId: varchar('correlation_id', { length: 256 }).notNull(),
    signalId: varchar('signal_id', { length: 64 }).notNull(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    severity: varchar('severity', { length: 16 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    affectedEntities: jsonb('affected_entities').notNull().default([]),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('business_problems_tenant_idx').on(table.tenantId),
    index('business_problems_tenant_workspace_idx').on(
      table.tenantId,
      table.workspaceId,
      table.detectedAt,
    ),
    // The deterministic dedupe identity — a repeated scan of the same
    // signal + scope + entity must resolve to the SAME row.
    uniqueIndex('business_problems_correlation_unique').on(table.tenantId, table.correlationId),
  ],
);

/**
 * remediation_plans — the durable lifecycle record of governed remediation
 * plans (Phase 10). One row per plan aggregate; the tenant id is the
 * isolation scope and the workspace id the workspace scope — every read is
 * scoped by both (a forged plan id from another tenant/workspace resolves
 * to nothing, fail closed). The plan is the dynamic, server-validated
 * derivation of the problem's applicable known solution + the caller's
 * agent capability set; steps live in `remediation_plan_steps` (their own
 * table so step lifecycle transitions are cheap conditional updates — the
 * atomic exactly-once claim that makes a duplicate advance request replay
 * instead of re-execute).
 *
 * Only lifecycle facts are stored relationally: problem/agent/role
 * references, status/version/replan count, and the grounding solution id.
 * The full problem investigation is NOT duplicated here — it is the
 * detection projection, recomputed deterministically at read time from the
 * trusted snapshot (S27 §17 minimum persistence).
 */
export const remediationPlans = pgTable(
  'remediation_plans',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    problemId: varchar('problem_id', { length: 64 }).notNull(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }),
    agentId: varchar('agent_id', { length: 64 }).notNull(),
    roleId: varchar('role_id', { length: 128 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    objective: text('objective').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    version: integer('version').notNull().default(1),
    replanCount: integer('replan_count').notNull().default(0),
    groundedSolutionId: varchar('grounded_solution_id', { length: 128 }),
    reason: text('reason'),
    outcome: jsonb('outcome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('remediation_plans_tenant_idx').on(table.tenantId),
    index('remediation_plans_tenant_problem_idx').on(table.tenantId, table.problemId),
    index('remediation_plans_tenant_workspace_idx').on(
      table.tenantId,
      table.workspaceId,
      table.updatedAt,
    ),
  ],
);

/**
 * remediation_plan_steps — the durable lifecycle record of one remediation
 * plan step (Phase 10). One row per step; the tenant id is the isolation
 * scope. Steps are the executable units of a plan: each maps to ONE
 * capability-bound governed execution. The step lifecycle transitions are
 * conditional updates (PENDING/AWAITING_APPROVAL → RUNNING) — the atomic
 * exactly-once claim: a duplicate or concurrent advance of the same step
 * can never execute the action twice.
 */
export const remediationPlanSteps = pgTable(
  'remediation_plan_steps',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    planId: varchar('plan_id', { length: 64 }).notNull(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    sequence: integer('sequence').notNull(),
    action: varchar('action', { length: 240 }).notNull(),
    capabilityId: varchar('capability_id', { length: 128 }).notNull(),
    description: text('description').notNull(),
    rationale: text('rationale').notNull(),
    dependencies: jsonb('dependencies').notNull().default([]),
    approvalRequirement: varchar('approval_requirement', { length: 16 }).notNull(),
    requiredApproverRoleId: varchar('required_approver_role_id', { length: 128 }),
    verificationRequirement: text('verification_requirement').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    result: jsonb('result'),
    evidence: jsonb('evidence'),
    approvalId: varchar('approval_id', { length: 64 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('remediation_steps_plan_idx').on(table.planId),
    index('remediation_steps_tenant_idx').on(table.tenantId),
  ],
);

/**
 * agents — AGENT IDENTITIES (Prompt 4). One row per automated security
 * principal, owned by exactly one organization (tenant) and one workspace.
 * An agent holds no authority of its own: `agent_delegations` grant it
 * individual capabilities. Rows are never deleted — `revoked` is terminal
 * and preserves the audit history of everything the agent did.
 */
export const agents = pgTable(
  'agents',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    definitionId: varchar('definition_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description').notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    ownerUserId: varchar('owner_user_id', { length: 64 }).notNull(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    statusChangedBy: varchar('status_changed_by', { length: 64 }),
    statusReason: text('status_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('agents_workspace_idx').on(table.organizationId, table.workspaceId),
    index('agents_owner_idx').on(table.organizationId, table.ownerUserId),
  ],
);

/**
 * agent_delegations — explicit capability grants to an agent (Prompt 4).
 * One row per (agent, capability, optional resource scope) grant, by one
 * human, inside the agent's organization + workspace, optionally bounded in
 * time. `expired` is never stored — it is derived at execution time from
 * `expires_at`. Revocation sets `status = revoked` + `revoked_at`; the row is
 * kept as evidence. The foreign key keeps a delegation from ever being
 * orphaned from its agent record.
 */
export const agentDelegations = pgTable(
  'agent_delegations',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    agentId: varchar('agent_id', { length: 64 })
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }).notNull(),
    grantedByUserId: varchar('granted_by_user_id', { length: 64 }).notNull(),
    capabilityId: varchar('capability_id', { length: 128 }).notNull(),
    resourceScope: jsonb('resource_scope'),
    status: varchar('status', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: varchar('revoked_by', { length: 64 }),
    revokeReason: text('revoke_reason'),
    metadata: jsonb('metadata').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('agent_delegations_agent_idx').on(table.agentId, table.status),
    index('agent_delegations_workspace_idx').on(table.organizationId, table.workspaceId),
  ],
);

/**
 * policy_settings — organization policy configuration (Prompt 5).
 *
 * APPEND-ONLY, versioned per (organization, policy): a change inserts a new
 * version and never rewrites an old one, so a historical decision that names
 * `POLICY_X@config.2` can always be explained exactly as it was. The current
 * configuration is the highest version. Only the policy engine's rules read
 * it (tenant-scoped by `organization_id`); nothing here grants authority —
 * configuration can only tighten what RBAC and delegation already allow.
 */
export const policySettings = pgTable(
  'policy_settings',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 64 }).notNull(),
    policyId: varchar('policy_id', { length: 96 }).notNull(),
    version: integer('version').notNull(),
    config: jsonb('config').notNull(),
    // Prompt 8: a disable is a NEW version with enabled=false (rows are only inserted).
    enabled: boolean('enabled').notNull().default(true),
    reason: varchar('reason', { length: 500 }),
    configHash: varchar('config_hash', { length: 64 }),
    changeType: varchar('change_type', { length: 24 }).notNull().default('version'),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('policy_settings_version_unique').on(
      table.organizationId,
      table.policyId,
      table.version,
    ),
  ],
);

/**
 * lineage_records — append-only evidence + data lineage (Prompt 6).
 *
 * One row per lineage fact: a retrieved piece of EVIDENCE (source type + exact
 * source id, version, fingerprint, retrieval time), a PLANNED_ACTION, an
 * actual EXECUTION, its separate VERIFICATION, a LINK edge, or a derived
 * FINDING. Rows are only ever inserted (the repository has no update or
 * delete), so a source that changes later never rewrites what was recorded:
 * a historical record keeps the version and fingerprint that were true then.
 * `data` holds compact structured facts only — ids, versions, fingerprints —
 * never raw documents, secrets, or model reasoning. Nothing here is read by
 * any authorization path. Reads are tenant-scoped (workspace optional).
 */
export const lineageRecords = pgTable(
  'lineage_records',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }),
    runId: varchar('run_id', { length: 96 }).notNull(),
    kind: varchar('kind', { length: 24 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    seq: integer('seq').notNull(),
    actorId: varchar('actor_id', { length: 64 }),
    agentId: varchar('agent_id', { length: 64 }),
    delegationId: varchar('delegation_id', { length: 64 }),
    approvalId: varchar('approval_id', { length: 64 }),
    invocationId: varchar('invocation_id', { length: 64 }),
    subjectType: varchar('subject_type', { length: 48 }),
    subjectId: varchar('subject_id', { length: 200 }),
    fingerprint: varchar('fingerprint', { length: 64 }),
    data: jsonb('data').notNull(),
  },
  (table) => [
    index('lineage_tenant_run_idx').on(table.tenantId, table.runId),
    index('lineage_tenant_approval_idx').on(table.tenantId, table.approvalId),
    index('lineage_tenant_workspace_time_idx').on(
      table.tenantId,
      table.workspaceId,
      table.occurredAt,
    ),
    index('lineage_tenant_subject_idx').on(
      table.tenantId,
      table.kind,
      table.subjectType,
      table.subjectId,
    ),
    index('lineage_tenant_invocation_idx').on(table.tenantId, table.invocationId),
  ],
);

/**
 * runtime_runs — append-only AI runtime observability (Prompt 7).
 *
 * One immutable row per orchestrated run (or MCP tool call): end-to-end and
 * per-stage timing, the model calls (provider, model, latency, token usage
 * only when reported, cost only from trusted pricing), the tools called, the
 * approval wait (separate from run latency), and — when it failed — WHERE and
 * WHY. Rows are only ever inserted (no update or delete path). The jsonb
 * columns hold ids, codes, counts, durations and fingerprints only — never
 * prompts, tool arguments, documents, secrets or model reasoning. Nothing here
 * is read by any authorization path. Reads are tenant-scoped.
 */
export const runtimeRuns = pgTable(
  'runtime_runs',
  {
    id: varchar('id', { length: 96 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 64 }),
    requestId: varchar('request_id', { length: 96 }),
    correlationId: varchar('correlation_id', { length: 96 }),
    actorId: varchar('actor_id', { length: 64 }).notNull(),
    agentId: varchar('agent_id', { length: 64 }),
    delegationId: varchar('delegation_id', { length: 64 }),
    origin: varchar('origin', { length: 24 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    durationMs: doublePrecision('duration_ms').notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    failureStage: varchar('failure_stage', { length: 24 }),
    failureCode: varchar('failure_code', { length: 48 }),
    failureClass: varchar('failure_class', { length: 24 }),
    provider: varchar('provider', { length: 48 }),
    model: varchar('model', { length: 128 }),
    modelExecution: varchar('model_execution', { length: 12 }),
    verified: boolean('verified'),
    tokensAvailable: boolean('tokens_available').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    cost: doublePrecision('cost'),
    /** The full immutable RuntimeRun (stages, models, tools, retrievals, policies, approval). */
    record: jsonb('record').notNull(),
  },
  (table) => [
    index('runtime_runs_tenant_time_idx').on(table.tenantId, table.startedAt),
    index('runtime_runs_tenant_workspace_time_idx').on(
      table.tenantId,
      table.workspaceId,
      table.startedAt,
    ),
    index('runtime_runs_tenant_status_idx').on(table.tenantId, table.status),
    index('runtime_runs_tenant_failure_stage_idx').on(table.tenantId, table.failureStage),
    index('runtime_runs_tenant_provider_model_idx').on(table.tenantId, table.provider, table.model),
    index('runtime_runs_tenant_agent_idx').on(table.tenantId, table.agentId),
    index('runtime_runs_tenant_request_idx').on(table.tenantId, table.requestId),
  ],
);
