/**
 * @nexora/app-web — client DTO types.
 *
 * The API response shapes consumed by the SPA (mirrors the application-layer
 * DTOs; API_CONTRACTS.md).
 */

/** A user as seen by the client. */
export interface UserDto {
  id: string;
  email: string;
  username: string;
  displayName: string;
  status: string;
  createdAt: string;
}

/** An organization as seen by the client. */
export interface OrganizationDto {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
}

/** A workspace as seen by the client. */
export interface WorkspaceDto {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
}

/** The `/me` response. */
export interface MeResponse {
  user: UserDto;
  organizations: OrganizationDto[];
}

/** An employee as seen by the client (HR vertical slice). */
export interface EmployeeDto {
  id: string;
  organizationId: string;
  name: string;
  status: string;
  createdAt: string;
}

/** A document as seen by the client (Documents + Knowledge vertical slice). */
export interface DocumentDto {
  id: string;
  organizationId: string;
  workspaceId: string;
  uploaderId: string;
  title: string;
  contentType: string;
  status: string;
  failureReason?: string;
  contentVersion: number;
  createdAt: string;
}

/** An immutable content revision of a document (S17 version history). */
export interface DocumentVersionDto {
  /** The version record id. */
  id: string;
  /** The owning document id. */
  documentId: string;
  /** The monotonic content revision number. */
  version: number;
  /** The content type of the revision. */
  contentType: string;
  /** The historical version this revision was restored from, when applicable. */
  restoredFromVersion?: number;
  /** The user that created the revision. */
  createdBy: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** A document template as seen by the client (S17). */
export interface DocumentTemplateDto {
  /** The template id. */
  id: string;
  /** The owning organization (tenant) id. */
  organizationId: string;
  /** The owning workspace id. */
  workspaceId: string;
  /** The template name. */
  name: string;
  /** An optional human-readable description. */
  description?: string;
  /** The starter content type. */
  contentType: string;
  /** The lifecycle status (`active` | `archived`). */
  status: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** A knowledge base article as seen by the client (S18 Knowledge Base). */
export interface KnowledgeArticleDto {
  /** The article id. */
  id: string;
  /** The owning organization (tenant) id. */
  tenantId: string;
  /** The owning workspace id. */
  workspaceId: string;
  /** The article title. */
  title: string;
  /** The article body. */
  body: string;
  /** The optional owning category id. */
  categoryId?: string;
  /** The lifecycle status (`draft` | `published` | `archived`). */
  status: string;
  /** The monotonic content version (cited by retrieval). */
  contentVersion: number;
  /** The authoring user id. */
  author: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
}

/** A knowledge base category as seen by the client (S18). */
export interface KnowledgeCategoryDto {
  /** The category id. */
  id: string;
  /** The owning organization (tenant) id. */
  tenantId: string;
  /** The owning workspace id. */
  workspaceId: string;
  /** The category name. */
  name: string;
  /** Whether the category is archived (terminal). */
  archived: boolean;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** A marketplace app listing as seen by the client (S19). */
export interface MarketplaceAppDto {
  /** The catalog app id, e.g. `com.nexora.hr`. */
  id: string;
  /** The display name. */
  name: string;
  /** The catalog (latest) version. */
  version: string;
  /** The marketplace summary. */
  summary: string;
  /** The marketplace description. */
  description: string;
  /** The publisher name. */
  publisher: string;
  /** The category tags. */
  categories: readonly string[];
  /** The scopes the app requires to function (the permission review). */
  requiredPermissions: readonly string[];
  /** The scopes the app is granted while active. */
  grantedPermissions: readonly string[];
  /** Whether the requesting workspace has this app installed. */
  installed: boolean;
  /** The installed version, when installed. */
  installedVersion?: string;
  /** The navigation label registered by the app (shell sidebar). */
  navigationLabel?: string;
}

/** A workspace-installed app as seen by the client (S19). */
export interface InstalledAppDto {
  /** The installation record id. */
  installationId: string;
  /** The app id, e.g. `com.nexora.hr`. */
  appId: string;
  /** The app display name (from the catalog). */
  name: string;
  /** The installed version. */
  version: string;
  /** The catalog's current version (whether an update is available). */
  latestVersion: string;
  /** Whether a newer catalog version exists. */
  updateAvailable: boolean;
  /** ISO-8601 UTC install time. */
  installedAt: string;
}

/** A project as seen by the client. */
export interface ProjectDto {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  status: string;
  createdAt: string;
}

/** The `/dashboard` response. */
export interface DashboardResponse {
  user: UserDto;
  organization: OrganizationDto | null;
  workspace: WorkspaceDto | null;
  installedApps: never[];
  recentActivity: never[];
}

/** A workflow instance as seen by the client (read-only execution view). */
export interface WorkflowInstanceDto {
  id: string;
  definitionId: string;
  definitionKey: string;
  tenantId: string;
  userId: string;
  workspaceId?: string;
  correlationId: string;
  status: string;
  currentStepId?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

/** A workflow step execution (the journal). */
export interface WorkflowStepExecutionDto {
  id: string;
  workflowId: string;
  tenantId: string;
  stepId: string;
  name: string;
  capabilityId: string;
  toolId: string;
  status: string;
  attempt: number;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  approvalId?: string;
  startedAt: string;
  finishedAt?: string;
}

/** A full workflow execution record (detail view). */
export interface WorkflowExecutionRecordDto {
  instance: WorkflowInstanceDto;
  steps: readonly WorkflowStepExecutionDto[];
}

/** A notification as seen by the client (Notification vertical slice). */
export interface NotificationDto {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'unread' | 'read';
  action?: { kind: 'approval' | 'navigate'; href: string; label: string };
  createdAt: string;
  readAt?: string;
}

/** An activity feed item as seen by the client (read model). */
export interface ActivityItemDto {
  id: string;
  type: string;
  title: string;
  body: string;
  actorId?: string;
  occurredAt: string;
}

/** The notification preferences as seen by the client. */
export interface NotificationPreferencesDto {
  categories: Record<string, boolean>;
  updatedAt: string;
}

/** A webhook endpoint as seen by the client (S20 Integrations). */
export interface WebhookEndpointDto {
  /** The endpoint id. */
  id: string;
  /** The target URL. */
  url: string;
  /** The subscribed event types. */
  eventTypes: readonly string[];
  /** Whether the endpoint is enabled. */
  enabled: boolean;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
  /** The masked signing secret (`whk_abcd…` — full secret shown once at creation). */
  secretMasked: string;
}

/** A webhook delivery receipt as seen by the client (S20). */
export interface WebhookDeliveryDto {
  /** The receipt id. */
  id: string;
  /** The webhook endpoint id. */
  endpointId: string;
  /** The business event id that triggered the delivery. */
  eventId: string;
  /** The business event type. */
  eventType: string;
  /** The terminal outcome (`delivered` | `failed`). */
  status: 'delivered' | 'failed';
  /** The final attempt number. */
  attempt: number;
  /** The HTTP status received (delivered only). */
  statusCode?: number;
  /** A human-readable failure reason (failed only). */
  error?: string;
  /** ISO-8601 UTC delivery time. */
  deliveredAt: string;
}

/** An email outbox record as seen by the client (S20). */
export interface EmailOutboxDto {
  /** The outbox record id. */
  id: string;
  /** The recipient email address. */
  recipientEmail: string;
  /** The subject line. */
  subject: string;
  /** The body text. */
  body: string;
  /** The source business event id. */
  sourceEventId: string;
  /** ISO-8601 UTC dispatch time. */
  dispatchedAt: string;
}

/** The webhook registry response (S20). */
export interface WebhookRegistryResponse {
  /** The workspace webhook endpoints (newest first). */
  endpoints: readonly WebhookEndpointDto[];
  /** The subscribable event catalog (checkboxes in the creator). */
  subscribableEvents: readonly string[];
}

/** The webhook creation response (the ONLY response with the full secret). */
export interface WebhookCreatedResponse {
  endpoint: WebhookEndpointDto;
  /** The full signing secret — exposed exactly once at creation. */
  secret: string;
}

// --- S23 Insights (pilot measurement dashboard) --------------------------

/** Workflow health per definition (PRD §20.4). */
export interface WorkflowHealthMetricDto {
  /** The stable definition key (e.g. `employee-onboarding`). */
  definitionKey: string;
  /** Total terminal instances in the tenant. */
  total: number;
  /** Instances that reached `succeeded`. */
  succeeded: number;
  /** Instances that reached `failed` (unrecoverable). */
  failed: number;
  /** Succeeded / total, 0–100. */
  successRate: number;
  /** Failed / total, 0–100. */
  unrecoverableErrorRate: number;
  /** Cycle time p50 in ms (started → finished of terminal instances). */
  cycleTimeP50Ms: number | null;
  /** Cycle time p95 in ms (started → finished of terminal instances). */
  cycleTimeP95Ms: number | null;
}

/** Onboarding progress per user (PRD §20.4). */
export interface OnboardingUserMetricDto {
  /** The user id. */
  userId: string;
  /** The user email. */
  email: string;
  /** ISO-8601 signup time. */
  signedUpAt: string;
  /** ISO-8601 first succeeded workflow time, when one exists. */
  firstWorkflowAt: string | null;
  /** Milliseconds from signup to first succeeded workflow, when known. */
  timeToFirstWorkflowMs: number | null;
}

/** Audit completeness (PRD §20.4). */
export interface AuditCompletenessMetricDto {
  /** Share of executions with an audit-trail entry, 0–100. */
  traceableShare: number;
  /** Total business executions (workflow instances). */
  totalEvents: number;
  /** Executions with at least one activity item in the same correlation scope. */
  tracedEvents: number;
  /** Definition keys whose executions have no audit-trail entry. */
  untracedTypes: readonly string[];
}

/** Tenant overview counts (PRD §20.4). */
export interface TenantOverviewDto {
  /** Users registered in the tenant. */
  users: number;
  /** Workspaces in the tenant. */
  workspaces: number;
  /** Projects in the tenant. */
  projects: number;
  /** Documents in the tenant. */
  documents: number;
  /** Knowledge sources (search corpus) in the tenant. */
  knowledgeSources: number;
  /** Calendar events in the tenant. */
  calendarEvents: number;
}

/** The full tenant measurement snapshot (S23 Insights page). */
export interface TenantMeasurementsDto {
  /** The tenant scope the metrics were computed for. */
  tenantId: string;
  /** ISO-8601 UTC time the snapshot was computed. */
  generatedAt: string;
  /** Workflow health per definition. */
  workflowHealth: readonly WorkflowHealthMetricDto[];
  /** Onboarding progress per user. */
  onboarding: readonly OnboardingUserMetricDto[];
  /** Audit completeness of the tenant's business executions. */
  auditCompleteness: AuditCompletenessMetricDto;
  /** Tenant overview counts. */
  overview: TenantOverviewDto;
}

/** The insights API response. */
export interface InsightsResponse {
  measurements: TenantMeasurementsDto;
}

// --- S24 Phase 2: dynamic role-aware Command Center --------------------------

/** A widget of the Command Center as rendered by the generic page. */
export interface CommandCenterWidgetDto {
  /** Stable widget id. */
  id: string;
  /** The widget kind (mapped to a renderer). */
  type: 'kpi' | 'activity' | 'attention' | 'list';
  /** Human-readable widget title. */
  title: string;
  /** Optional widget description. */
  description?: string;
  /** Optional layout hint (1 = half width, 2 = full width). */
  span?: 1 | 2;
}

/** An action of the Command Center (read/navigation only in Phase 2). */
export interface CommandCenterActionDto {
  /** Stable action id. */
  id: string;
  /** Human-readable action label. */
  label: string;
  /** The action kind (`navigate` only in Phase 2). */
  kind: 'navigate';
  /** The frontend destination. */
  href: string;
  /** Optional action icon hint. */
  icon?: string;
}

/** An entry of a list/activity/attention widget. */
export interface CommandCenterEntryDto {
  /** The underlying record id. */
  id: string;
  /** The entry title. */
  title: string;
  /** Optional supporting body. */
  body?: string;
  /** Optional supporting text. */
  subtitle?: string;
  /** Optional lifecycle status. */
  status?: string;
  /** Optional destination. */
  href?: string;
  /** ISO-8601 UTC time, when time-based. */
  occurredAt?: string;
  /** Optional notification priority. */
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

/** The data of one rendered widget (kind-tagged). */
export type CommandCenterWidgetDataDto =
  | {
      kind: 'kpi';
      value: string;
      hint?: string;
      tone?: 'neutral' | 'success' | 'warning' | 'danger';
    }
  | {
      kind: 'activity' | 'attention' | 'list';
      items: readonly CommandCenterEntryDto[];
    };

/** The system an agent action targets (S26 Phase 8). */
export type AgentTargetSystem = 'nexora' | 'github' | 'slack' | 'calendar' | 'email';

/** An agent goal (S26 Phase 8). */
export interface AgentGoal {
  id: string;
  name: string;
  description: string;
  capabilityIds: readonly string[];
}

/** An agent operating policy (S26 Phase 8). */
export interface AgentOperatingPolicy {
  id: string;
  statement: string;
}

/** A governed action proposal (S26 Phase 8). */
export interface AgentProposal {
  id: string;
  action: string;
  reason: string;
  affectedEntity?: { type: string; id: string; title: string };
  targetSystem: AgentTargetSystem;
  requiredCapability: string;
  requiresApproval: boolean;
  expectedResult: string;
  goalId?: string;
}

/** A display-safe executed step of a governed agent run. */
export interface AgentExecutionStep {
  stepId: string;
  capabilityId: string;
  toolId: string;
  status: 'succeeded' | 'failed' | 'blocked' | 'skipped';
  output?: unknown;
  error?: string;
  verified: boolean;
}

/** An approval gate outcome of a governed agent run. */
export interface AgentApprovalOutcome {
  id?: string;
  stepId: string;
  toolId: string;
  capabilityId?: string;
  status: 'granted' | 'pending' | 'rejected';
  sideEffectClass: string;
  input?: Record<string, unknown>;
}

/** The outcome of one governed agent execution. */
export interface AgentExecutionOutcome {
  status: 'completed' | 'blocked' | 'failed' | 'clarification' | 'rejected';
  runId?: string;
  response: string;
  steps: readonly AgentExecutionStep[];
  approvals: readonly AgentApprovalOutcome[];
  decision?: { id: string; outcome: string; madeAt: string };
}

/** A journaled agent execution (measurements). */
export interface AgentExecutionRecord {
  id: string;
  agentId: string;
  roleId: string;
  domainId: string;
  tenantId: string;
  workspaceId?: string;
  userId: string;
  proposalId?: string;
  proposalAction?: string;
  status: string;
  runId?: string;
  reason?: string;
  createdAt: string;
}

// --- S27: proactive problem detection (agent DTO + problems console) ----

/** The explicit severity of a detected business problem (controlled). */
export type ProblemSeverity = 'low' | 'medium' | 'high';

/** The explicit problem lifecycle (deterministic transitions only). */
export type ProblemStatus =
  | 'DETECTED'
  | 'INVESTIGATING'
  | 'UNDERSTOOD'
  | 'SOLUTION_FOUND'
  | 'NO_SOLUTION_FOUND'
  | 'ACTION_PROPOSED'
  | 'WAITING_FOR_APPROVAL'
  | 'RESOLVED';

/** A grounded evidence item (FACT or bounded INFERENCE from a persisted source). */
export interface ProblemEvidence {
  id: string;
  source: string;
  entityType?: string;
  entityId?: string;
  entityTitle?: string;
  fact: string;
  occurredAt?: string;
}

/** A root-cause candidate with an explicit FACT vs INFERENCE distinction. */
export interface RootCauseCandidate {
  explanation: string;
  supportingEvidenceIds: readonly string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  kind: 'FACT' | 'INFERENCE';
  affectedEntity?: { type: string; id: string; title: string };
  nextStep: string;
}

/** A discovered solution candidate (existing knowledge first — never invented). */
export interface SolutionCandidate {
  id: string;
  source: string;
  title: string;
  description: string;
  reference?: { id: string; title: string };
  applicability: 'FOUND' | 'APPLICABLE' | 'REJECTED';
  rejectionReason?: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  requiredCapabilities: readonly string[];
}

/** The deterministic recommendation (+ governed action proposal) of a problem. */
export interface ProblemRecommendation {
  summary: string;
  actionProposal?: AgentProposal;
  groundedIn?: string;
}

/** A detected business problem with its full investigation (S27). */
export interface BusinessProblemDto {
  id: string;
  correlationId: string;
  signalId: string;
  signalName: string;
  tenantId: string;
  workspaceId?: string;
  title: string;
  description: string;
  severity: ProblemSeverity;
  status: ProblemStatus;
  detectedAt: string;
  updatedAt: string;
  affectedEntities: readonly { type: string; id: string; title: string }[];
  evidence: readonly ProblemEvidence[];
  rootCauses: readonly RootCauseCandidate[];
  solutions: readonly SolutionCandidate[];
  recommendation?: ProblemRecommendation;
}

/** The governed business agent returned by `GET /api/agent`. */
export interface BusinessAgentDto {
  id: string;
  name: string;
  domainId: string;
  domainName: string;
  roleId: string;
  roleName: string;
  description: string;
  autonomyLevel: 'read_only' | 'assisted' | 'governed_execution';
  goals: readonly AgentGoal[];
  policies: readonly AgentOperatingPolicy[];
  capabilities: readonly { id: string; name: string }[];
  proposals: readonly AgentProposal[];
  recentRuns: readonly AgentExecutionRecord[];
  /** The detected problems of the caller's scope (S27) — empty when none. */
  problems: readonly BusinessProblemDto[];
}

/** The governed agent execution response. */
export interface AgentExecutionResponse {
  agent: BusinessAgentDto;
  outcome: AgentExecutionOutcome;
}

// --- Phase 10: governed remediation planning (problem → plan → execute) --

/** The remediation plan lifecycle. */
export type RemediationPlanStatus =
  | 'DRAFT'
  | 'VALIDATED'
  | 'AWAITING_APPROVAL'
  | 'READY'
  | 'EXECUTING'
  | 'PAUSED'
  | 'REPLANNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BLOCKED';

/** The plan step lifecycle. */
export type PlanStepStatus =
  'PENDING' | 'AWAITING_APPROVAL' | 'RUNNING' | 'VERIFIED' | 'BLOCKED' | 'FAILED' | 'SKIPPED';

/** Whether a step's capability requires a human decision before it runs. */
export type PlanApprovalRequirement = 'NONE' | 'REQUIRED';

/** The final verification of a completed plan. */
export interface RemediationOutcomeDto {
  status: 'resolved' | 'unresolved';
  finalVerification: string;
  verifiedAt: string;
}

/** One remediation plan step: what will happen, why, and how it is gated. */
export interface PlanStepDto {
  id: string;
  planId: string;
  sequence: number;
  action: string;
  capabilityId: string;
  description: string;
  rationale: string;
  dependencies: readonly string[];
  approvalRequirement: PlanApprovalRequirement;
  requiredApproverRoleId?: string;
  verificationRequirement: string;
  status: PlanStepStatus;
  result?: unknown;
  evidence?: readonly string[];
  approvalId?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

/** A dynamic, server-validated remediation plan for a detected problem. */
export interface RemediationPlanDto {
  id: string;
  problemId: string;
  problem: BusinessProblemDto;
  tenantId: string;
  workspaceId?: string;
  agentId: string;
  roleId: string;
  title: string;
  objective: string;
  status: RemediationPlanStatus;
  version: number;
  replanCount: number;
  groundedSolutionId?: string;
  reason?: string;
  steps: readonly PlanStepDto[];
  outcome?: RemediationOutcomeDto;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/** A grounded knowledge retrieval citation (S18 Knowledge retrieval). */
export interface KnowledgeReferenceDto {
  sourceId: string;
  documentId: string;
  kind: string;
  version: number;
  title: string;
  workspaceId: string;
  snippet: string;
}

// --- S27 Phase 6: role/context switcher --------------------------------

/** One switchable (organization, workspace) → resolved business role. */
export interface RoleContextOption {
  organizationId: string;
  organizationName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceType: string;
  domainId: string;
  domainName: string;
  roleId: string;
  roleName: string;
  /**
   * The role's RBAC permission set (S34) — drives module/nav visibility and
   * action-button gating. Presentation only: the backend re-checks the SAME
   * set on every protected route, so this can never be the source of real
   * access.
   */
  permissions: readonly string[];
}

/** The `/role-context` response — the current role plus every switchable option. */
export interface RoleContextResponse {
  current: RoleContextOption | null;
  options: readonly RoleContextOption[];
}

/** The full command-center view returned by `GET /api/command-center`. */
export interface CommandCenterDto {
  /** The command center id. */
  id: string;
  /** Human-readable command center name. */
  name: string;
  /** The owning business domain id. */
  domainId: string;
  /** The owning business domain name. */
  domainName: string;
  /** The bound business role id. */
  roleId: string;
  /** The bound business role name. */
  roleName: string;
  /** Optional command center description. */
  description?: string;
  /** The composed widgets, in display order. */
  widgets: readonly CommandCenterWidgetDto[];
  /** The composed actions. */
  actions: readonly CommandCenterActionDto[];
  /** Widget id → widget data. */
  data: Readonly<Record<string, CommandCenterWidgetDataDto>>;
}
