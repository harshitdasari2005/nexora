/**
 * @nexora/evaluation — the scenario schema (dataset contract).
 *
 * A scenario is APPLICATION / EVALUATION data — a deterministic enterprise
 * world, one user request, and the observable behavior Nexora is expected to
 * exhibit. It is never model-training data: nothing here is fed to a model;
 * the runner drives the real API and compares what it observes against the
 * expectations below.
 *
 * Expectations are STRUCTURAL (capability ids, side-effect classes,
 * authorization outcomes, persisted state, audit journal rows, and facts that
 * come from the scenario's own world data) — never expected UI/narration
 * text, so a copy change can never break a scenario and a scenario can never
 * pass by matching a canned sentence.
 */

/** The schema version of scenario definitions (bump on breaking change). */
export const SCENARIO_SCHEMA_VERSION = '1.6.0';

/** The coverage categories every catalog must span (see catalog validation). */
export const SCENARIO_CATEGORIES = [
  'project_risk',
  'finance_budget_overrun',
  'calendar',
  'hr_operation',
  'knowledge_retrieval',
  'remediation',
  'approval_workflow',
  'cross_workspace_denial',
  'cross_organization_denial',
  'unauthorized_mutation',
  'prompt_injection',
  'tool_failure',
  'approval_rejection',
  'execution_failure',
  'verification_failure',
  // 1.1.0 — AI runtime security (trust boundaries)
  'approval_bypass',
  'malicious_tool_output',
  // 1.3.0 — agent identity + delegated capabilities
  'delegation_denial',
  'forged_agent_context',
  'agent_lifecycle',
  'delegated_execution',
  // 1.4.0 — the central policy engine
  'policy_enforcement',
  // 1.5.0 — evidence provenance + data lineage
  'evidence_lineage',
  // 1.6.0 — AI runtime observability + execution telemetry
  'runtime_observability',
  // 1.5.0 — central policy administration + approval governance
  'policy_governance',
  // 1.6.0 — governed business execution: the full lifecycle (request → policy →
  // approval → execution → verification → lineage → audit) with actor continuity
  'governed_lifecycle',
] as const;

/** A scenario coverage category. */
export type ScenarioCategory = (typeof SCENARIO_CATEGORIES)[number];

/** Organization/workspace membership tier (the ONLY authorization level stored). */
export type MembershipTier = 'owner' | 'admin' | 'member';

/**
 * A workspace membership tier: the three ordinary tiers plus `executive`, an
 * organization executive's oversight seat in a department workspace.
 */
export type WorkspaceMembershipTier = MembershipTier | 'executive';

// ---------------------------------------------------------------------------
// World (deterministic initial state)
// ---------------------------------------------------------------------------

/** An organization (the tenant). */
export interface OrganizationFixture {
  /** Stable key referenced by other fixtures and requests. */
  key: string;
  /** Deterministic id (see {@link deterministicId}). */
  id: string;
  slug: string;
  name: string;
  /**
   * The user + workspace the runner reads the Audit Center as (a member
   * holding `audit.read`). Audit expectations for this organization are
   * evaluated through the real `GET /api/audit/events` surface.
   */
  auditor: { user: string; workspace: string };
}

/** A workspace inside an organization. */
export interface WorkspaceFixture {
  key: string;
  id: string;
  /** The owning organization key. */
  organization: string;
  slug: string;
  name: string;
  /** Workspace type (trusted, server-side data that selects the business role). */
  type: string;
}

/** A user (provisioned locally; authenticated through the real OIDC callback). */
export interface UserFixture {
  key: string;
  id: string;
  email: string;
  displayName: string;
  /** Job title (profile data only — never an authorization input). */
  title?: string;
}

/** An organization membership. */
export interface OrganizationMembershipFixture {
  user: string;
  organization: string;
  tier: MembershipTier;
}

/** A workspace membership, with the business role it is EXPECTED to resolve to. */
export interface WorkspaceMembershipFixture {
  user: string;
  workspace: string;
  tier: WorkspaceMembershipTier;
  /**
   * The business role id the platform must resolve for this membership
   * (membership tier × workspace type). Verified by the runner through
   * `GET /api/role-context` before the scenario request runs, so a drift in
   * role resolution fails loudly as a fixture error, never silently.
   */
  expectedRole: string;
}

/** Business entities a world can contain (all constructed through real domain aggregates). */
export type EntityFixture =
  | ProjectFixture
  | EmployeeFixture
  | BudgetFixture
  | ExpenseFixture
  | CalendarEventFixture
  | KnowledgeArticleFixture
  | DocumentFixture
  | NotificationFixture
  | MeasurementFixture
  | ConnectorFixture
  | AgentFixture
  | DelegationFixture
  | PolicyFixture;

export interface ProjectFixture {
  kind: 'project';
  key: string;
  id: string;
  organization: string;
  name: string;
  description?: string;
  status: 'proposed' | 'active' | 'on_hold' | 'completed';
}

export interface EmployeeFixture {
  kind: 'employee';
  key: string;
  id: string;
  organization: string;
  name: string;
  status: 'proposed' | 'hired' | 'onboarding' | 'active';
}

export interface BudgetFixture {
  kind: 'budget';
  key: string;
  id: string;
  organization: string;
  workspace: string;
  createdBy: string;
  name: string;
  allocatedMinorUnits: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  status: 'active' | 'under_review' | 'closed';
}

export interface ExpenseFixture {
  kind: 'expense';
  key: string;
  id: string;
  organization: string;
  workspace: string;
  budget: string;
  submittedBy: string;
  /** The decider (must differ from the submitter — segregation of duties). */
  decidedBy?: string;
  description: string;
  amountMinorUnits: number;
  currency: string;
  status: 'submitted' | 'approved' | 'rejected';
}

export interface CalendarEventFixture {
  kind: 'calendar_event';
  key: string;
  id: string;
  organization: string;
  workspace: string;
  createdBy: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface KnowledgeArticleFixture {
  kind: 'knowledge_article';
  key: string;
  id: string;
  organization: string;
  workspace: string;
  author: string;
  title: string;
  body: string;
  status: 'draft' | 'published';
  /** Whether the article is in the retrieval index (published articles normally are). */
  indexed: boolean;
}

export interface DocumentFixture {
  kind: 'document';
  key: string;
  id: string;
  organization: string;
  workspace: string;
  uploader: string;
  title: string;
  /** The extracted text indexed into knowledge retrieval. */
  text: string;
}

export interface NotificationFixture {
  kind: 'notification';
  key: string;
  organization: string;
  workspace: string;
  recipient: string;
  type: string;
  category: string;
  title: string;
  body: string;
  sourceEventId: string;
}

/**
 * A tenant measurements snapshot (workflow health etc.). In PostgreSQL these
 * are SQL aggregates over real workflow rows, so this fixture applies to the
 * in-memory evaluation harness ONLY — the Postgres seeder skips it and says
 * so (never a fabricated aggregate row).
 */
export interface MeasurementFixture {
  kind: 'measurements';
  key: string;
  organization: string;
  workflowHealth: readonly {
    definitionKey: string;
    total: number;
    succeeded: number;
    failed: number;
    successRate: number;
    unrecoverableErrorRate: number;
    cycleTimeP50Ms: number;
    cycleTimeP95Ms: number;
  }[];
}

/**
 * An external connector connection (simulated provider). Harness-only: the
 * evaluation never calls a real third-party API; `behavior` selects a
 * deterministic fixture transport.
 */
export interface ConnectorFixture {
  kind: 'connector';
  key: string;
  organization: string;
  provider: 'github';
  /**
   * `healthy` canned data, `unavailable` (HTTP 503), or `malicious`: every
   * response carries hostile text and control-looking fields (instructions,
   * fake approvals, fake permission grants) that must be treated as data.
   * `slow` answers correctly after `delayMs` (a real slow dependency).
   * `phantom` lies about writes: a create answers 201 with a plausible
   * record, but reading that record back answers 404 (nothing was stored).
   */
  behavior: 'healthy' | 'unavailable' | 'malicious' | 'slow' | 'phantom';
  /** For `slow`: how long every provider response takes (real elapsed time). */
  delayMs?: number;
}

/**
 * A persisted agent identity (Prompt 4). Provisioned straight into the
 * agent repositories exactly as `POST /api/agents` would store it — the
 * evaluation of the CREATION path itself goes through the `http` channel.
 */
export interface AgentFixture {
  kind: 'agent';
  key: string;
  id: string;
  organization: string;
  workspace: string;
  /** The business-agent definition (capability ceiling): executive | manager | developer | finance | hr. */
  definition: string;
  name: string;
  /** The owning user key — ownership is NOT authority. */
  owner: string;
  status: 'active' | 'suspended' | 'revoked';
}

/**
 * A delegation of ONE capability to an agent (Prompt 4). Fixtures are
 * stored directly (like an already-granted delegation); grant-time
 * validation is exercised through the `http` channel.
 */
export interface DelegationFixture {
  kind: 'delegation';
  key: string;
  id: string;
  /** The agent fixture key. */
  agent: string;
  /** The granting user key (their authority is re-checked at execution). */
  grantedBy: string;
  capability: string;
  /** Restricts the grant to one resource (an entity fixture key). */
  scope?: { kind: 'project' | 'budget'; entity: string };
  /** Absolute expiry instant (compared with the harness authority clock). */
  expiresAt?: string;
  /** Stored as already revoked. */
  revoked?: boolean;
}

/**
 * An organization policy configuration version (Prompt 5), appended in the
 * order fixtures are declared (version 1, 2, …). Evaluation-only: org-level
 * configuration would bleed across every scenario of a shared database, so
 * the PostgreSQL seeder skips it (and says so).
 */
export interface PolicyFixture {
  kind: 'policy';
  key: string;
  organization: string;
  /** The stable policy id, e.g. `POLICY_FINANCE_BUDGET_LIMIT`. */
  policyId: string;
  /** The raw configuration (deliberately `unknown`: invalid configs are scenarios too). */
  config: unknown;
  /** The configuring user key (recorded as `created_by`). */
  createdBy: string;
}

/** A complete, deterministic enterprise world. */
export interface ScenarioWorld {
  /** Stable world id (e.g. `nexora-enterprise-v1`). */
  id: string;
  /** Fixed reference instant — every fixture timestamp derives from it. */
  referenceTime: string;
  organizations: readonly OrganizationFixture[];
  workspaces: readonly WorkspaceFixture[];
  users: readonly UserFixture[];
  organizationMemberships: readonly OrganizationMembershipFixture[];
  workspaceMemberships: readonly WorkspaceMembershipFixture[];
  entities: readonly EntityFixture[];
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/** A human approval decision taken after the request surfaces a gate. */
export interface ApprovalDecisionStep {
  decision: 'approve' | 'reject';
  /** The deciding user key. */
  actor: string;
  reason?: string;
  /**
   * A real pause (ms) between the gate opening and the decision — the human
   * think-time that observability must keep out of execution latency.
   */
  delayMs?: number;
}

/** A natural-language request to the Enterprise AI (`POST /api/ai/chat`). */
export interface ChatRequest {
  channel: 'chat';
  actor: string;
  /** Organization scope sent with the request (omit for the actor's default). */
  organization?: string;
  workspace?: string;
  /** The message. `{org:k}` / `{ws:k}` / `{id:k}` / `{user:k}` placeholders resolve to world ids. */
  message: string;
  /** Changes applied after the approval gate opened and BEFORE any `decision` (like an agent's `afterGate`). */
  afterGate?: readonly AgentLifecycleStep[];
  decision?: ApprovalDecisionStep;
  /** Trusted changes applied after the request completes (source edits, budget closure, follow-up questions). */
  after?: readonly AgentLifecycleStep[];
}

/**
 * The governed remediation loop: scan → problem (by signal) → plan →
 * advance (→ approval → decision → advance) until terminal or bounded.
 */
export interface RemediationRequest {
  channel: 'remediation';
  actor: string;
  organization: string;
  workspace: string;
  signalId: string;
  /** Changes / attempts made once the approval gate opened and BEFORE any `decision` (`{plan}` = the plan id). */
  afterGate?: readonly AgentLifecycleStep[];
  decision?: ApprovalDecisionStep;
  /** Upper bound on `advance` calls (default 4). */
  maxAdvances?: number;
  /** Real calls made after the remediation loop finished (`{plan}` = the plan id). */
  after?: readonly AgentLifecycleStep[];
}

/**
 * A direct REST call (authorization tests of the non-AI surface). `path` and
 * string `body` values may use `{org:<key>}`, `{ws:<key>}`, `{id:<entityKey>}`
 * and `{user:<key>}` placeholders — resolved from the world, never literal ids.
 */
export interface HttpRequest {
  channel: 'http';
  actor: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  /** Further real calls / decisions made after the primary request (their outcomes are recorded by label). */
  after?: readonly AgentLifecycleStep[];
}

/**
 * A direct call to Nexora's remote MCP surface (`/api/mcp`, streamable HTTP)
 * as an external MCP client would make it — tool arguments here are the
 * untrusted, client/model-supplied values.
 */
export interface McpRequest {
  channel: 'mcp';
  actor: string;
  organization: string;
  /** The workspace selected with the `X-Nexora-Workspace` header. */
  workspace?: string;
  /**
   * Bind the session to a persisted agent (`X-Nexora-Agent` header — an
   * agent fixture key). The header is a CLAIM: the server validates it.
   */
  agent?: string;
  /** Overrides the agent header with a literal id (fabricated / foreign ids). */
  agentId?: string;
  /** The MCP tool name (e.g. `nexora.github.issues.list`). */
  tool: string;
  /** Tool arguments; string values resolve `{org:k}`-style placeholders. */
  arguments: Record<string, unknown>;
  /**
   * Further tool calls made on the SAME session after the primary call. Each
   * outcome is recorded under its `label` (status 403 when the call was
   * refused, 200 otherwise; `errorCode` = the structured error code) and is
   * asserted with a `probe` check.
   */
  additional?: readonly {
    label: string;
    tool: string;
    arguments: Record<string, unknown>;
  }[];
  /** Lifecycle steps applied after the primary call and BEFORE the `additional` calls (e.g. a decision on the approval it opened). */
  afterGate?: readonly AgentLifecycleStep[];
  /** Further real calls / decisions made after the MCP calls (recorded by label). */
  after?: readonly AgentLifecycleStep[];
}

/** A trusted lifecycle change made between an approval gate and its decision. */
export type AgentLifecycleStep =
  | { kind: 'revoke_delegation'; delegation: string }
  | { kind: 'suspend_agent'; agent: string }
  | { kind: 'advance_clock'; to: string }
  /**
   * A trusted operator hook that simulates a worker dying mid-execution: the
   * run's first approval is granted (as `approver`, straight on the approval
   * store) and CLAIMED (`approved → executing`) with NO outcome ever recorded
   * and NO tool executed. Recovery is then exercised by moving the clock past
   * the `executing` lease and touching the pending route.
   */
  | { kind: 'claim_and_abandon_approval'; approver: string }
  /** A trusted operator appends the next version of an organization policy configuration. */
  | { kind: 'set_policy'; organization: string; policyId: string; config: unknown; by: string }
  /** A user closes a budget (its persisted state changes after evidence about it was gathered). */
  | { kind: 'close_budget'; budget: string; by: string }
  /** A user edits a knowledge article (its source version bumps and it is re-indexed). */
  | { kind: 'update_article'; article: string; title: string; body: string; by: string }
  /** The same user asks the AI another question in a workspace (a second retrieval). */
  | { kind: 'ask'; actor: string; workspace: string; message: string }
  /**
   * A real HTTP call made as a world user (policy administration, REST
   * mutations, operator routes). The status, error code and body are
   * recorded under `label` and asserted by a `probe` check. `path` and
   * string body values resolve `{org:k}` / `{ws:k}` / `{id:k}` / `{user:k}`.
   */
  | {
      kind: 'http';
      label: string;
      actor: string;
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      path: string;
      body?: Record<string, unknown>;
    }
  /**
   * A decision on the run's first approval, made as `actor` through the REAL
   * decision route. Unlike `decision` the outcome is recorded (status, code)
   * under `label`, so a REFUSED decision is an observation, not a scenario
   * error. `extra` fields are sent verbatim in the body (forged claims).
   */
  | {
      kind: 'decide';
      label: string;
      actor: string;
      decision: 'approve' | 'reject';
      extra?: Record<string, unknown>;
      /**
       * Decide THIS literal approval id instead of the run's own (a fabricated
       * or foreign id). The server must refuse it; nothing is consumed.
       */
      approvalId?: string;
    }
  /**
   * A decision on the newest SUBMITTED expense of a workspace through the
   * real `POST /api/finance/expenses/:id/decide` route (the domain's own
   * money-movement approval — distinct from the AI approval). The outcome is
   * recorded under `label`.
   */
  | {
      kind: 'decide_expense';
      label: string;
      actor: string;
      decision: 'approve' | 'reject';
      organization: string;
      workspace: string;
    }
  /**
   * A hostile REPLAY of the run's first approval at the approval engine's
   * single-flight `claim` — the one gate every execution path (chat resume,
   * MCP re-call, workflow resume) funnels through. The outcome is recorded
   * under `label`: status 200 when the approval was claimed (an execution
   * would follow), 409 when refused. A rejected / expired / already-consumed
   * approval must always be refused.
   */
  | { kind: 'replay_claim'; label: string }
  /**
   * A trusted operator removes an external connector connection (credentials
   * revoked / integration disabled), so its tools are no longer discoverable.
   */
  | { kind: 'disconnect_connector'; organization: string; provider: 'github' }
  /**
   * A hostile write into the runtime telemetry store: every recorded run of
   * the organization is cloned into a FORGED run that claims a completed,
   * approved execution. Telemetry can never become an authority source, so
   * no decision may change.
   */
  | { kind: 'tamper_telemetry'; organization: string }
  /**
   * HARNESS-ONLY, contrived (see the README, "Closure scenarios"): starts a
   * REGISTERED workflow definition through the app's real
   * `WorkflowApplicationService` (the same handler `POST /api/workflows` calls)
   * with a narrower instance ceiling than any composed entry point would bind.
   * The composed surfaces refuse to start a workflow whose inner steps the
   * initiator lacks (the up-front check), so this is the only way to prove that
   * the ceiling bound to a STARTED instance still refuses an inner step outside
   * it. Outcome recorded under `label`: status 201 = the instance started
   * (body carries its final status and per-step statuses), else 400.
   */
  | {
      kind: 'start_workflow';
      label: string;
      /** The initiating user key (trusted actor recorded on the instance). */
      actor: string;
      organization: string;
      workspace?: string;
      definitionKey: string;
      input: Record<string, unknown>;
      /** The instance ceiling (capability ids). `[]` = an instance that permits nothing. */
      ceiling: readonly string[];
    }
  /**
   * HARNESS-ONLY, contrived: invokes one tool straight through a `ToolExecutor`
   * built exactly like the MCP server's (the app's real tool registry, policy,
   * lineage, security sink) with an explicit ceiling MODE. No composed surface
   * ever passes an EMPTY ceiling to the executor (discovery, MCP visibility and
   * the workflow adapter refuse first), so this is the only way to prove the
   * executor's own last line: `absent` = trusted internal caller (unrestricted),
   * `[]` = no authority, non-empty = only the listed capabilities. Outcome
   * recorded under `label`: 200 = executed, 403 = refused (`errorCode` = the
   * executor's failure code, e.g. FORBIDDEN).
   */
  | {
      kind: 'invoke_tool';
      label: string;
      actor: string;
      organization: string;
      workspace: string;
      /** The executable tool id (e.g. `calendar.create_event`). */
      tool: string;
      input: Record<string, unknown>;
      ceiling: 'absent' | readonly string[];
    };

/**
 * A run AS a persisted agent (`POST /api/agents/:agentId/execute`) — the
 * initiating user, the agent identity, and the delegation are all resolved
 * server-side. `agentId` overrides the path id with a literal (forged /
 * foreign / fabricated ids); it never changes what the server trusts.
 */
export interface AgentRequest {
  channel: 'agent';
  /** The initiating user (must hold `agent.execute`). */
  actor: string;
  organization: string;
  workspace: string;
  /** The agent fixture key to run. */
  agent: string;
  /** Overrides the agent id in the request path (placeholders resolve). */
  agentId?: string;
  /** Overrides the scope workspace of the request (an agent run in ANOTHER workspace). */
  scopeWorkspace?: string;
  utterance: string;
  /** Changes applied after the approval gate opened and BEFORE any decision. */
  afterGate?: readonly AgentLifecycleStep[];
  /**
   * A second utterance run AS the agent after the gate (`{approval}` = the
   * pending approval id) — e.g. the agent trying to approve its own gate.
   */
  followUp?: string;
  decision?: ApprovalDecisionStep;
}

export type ScenarioRequest =
  ChatRequest | RemediationRequest | HttpRequest | McpRequest | AgentRequest;

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

/** The observable intent class of a request. */
export type IntentKind =
  'information' | 'action' | 'workflow' | 'remediation' | 'clarification' | 'refused';

/** A persisted-state check evaluated after the request (verification). */
export type StateCheck =
  | {
      kind: 'count';
      entity: 'calendar_event' | 'project' | 'employee' | 'resource_assignment' | 'budget';
      organization: string;
      workspace?: string;
      /** Exact-match filter on the entity's name/title (world data, never UI text). */
      named?: string;
      /**
       * Employee lifecycle filter (employees only): count only employees in
       * this status. Distinguishes "no live employee was left behind" from
       * "the record was retained for audit" — rollback ends an employment, it
       * never deletes the record.
       */
      status?: string;
      /** Employee lifecycle filter (employees only): exclude these statuses. */
      statusNot?: readonly string[];
      equals: number;
    }
  | { kind: 'budget_status'; budget: string; equals: string }
  /**
   * Stored workflow INSTANCES of an organization, optionally narrowed by
   * definition, final status and origin. Distinguishes "the workflow could not
   * start" (no instance) from "it started and an inner step was refused"
   * (an instance in status failed / compensated).
   */
  | {
      kind: 'workflow_instances';
      organization: string;
      definitionKey?: string;
      status?: string;
      origin?: string;
      equals: number;
    }
  /** Stored delegations of an agent (any status) — grants never appear from a refusal. */
  | { kind: 'delegation_count'; agent: string; equals: number }
  /** A delegation's STORED status (`active` | `revoked`); history is never deleted. */
  | { kind: 'delegation_status'; delegation: string; equals: string }
  | { kind: 'agent_status'; agent: string; equals: string }
  /** Expenses stored in a workspace (any status) — a refused submission leaves none behind. */
  | { kind: 'expense_count'; organization: string; workspace: string; equals: number }
  /**
   * Counts lineage records (evidence / plan / execution / verification / link /
   * finding) of an organization that match every stated attribute. `has*`
   * flags test presence of a link (approval, policy, invocation identity…).
   * `distinctFingerprints` instead asserts how many DIFFERENT fingerprints the
   * matched records carry (e.g. a plan that changed between approval and resume).
   */
  | {
      kind: 'lineage';
      organization: string;
      record: 'EVIDENCE' | 'PLANNED_ACTION' | 'EXECUTION' | 'VERIFICATION' | 'LINK' | 'FINDING';
      workspace?: string;
      tool?: string;
      status?: string;
      origin?: string;
      purpose?: 'step' | 'compensation';
      verified?: boolean;
      hasApproval?: boolean;
      hasPolicy?: boolean;
      hasInvocation?: boolean;
      hasContextFingerprint?: boolean;
      policyId?: string;
      sourceType?: string;
      /** The exact source: an entity fixture key resolved to its id. */
      subjectEntity?: string;
      sourceVersion?: number;
      trust?: string;
      connector?: string;
      derived?: boolean;
      /** A LINK record's relation (`STEP_RUN`, `STEP_APPROVAL`, …). */
      relation?: string;
      /** The record's subject type (e.g. `REMEDIATION_BASIS`, `REMEDIATION_STEP`). */
      subjectType?: string;
      distinctFingerprints?: number;
      equals?: number;
      atLeast?: number;
    }
  /** Structural integrity of the append-only lineage of an organization. */
  | {
      kind: 'lineage_integrity';
      organization: string;
      rule:
        | 'verification_links_execution'
        | 'execution_has_verification'
        | 'finding_references_evidence';
    }
  /**
   * The Audit Center decision trace of the run's first approval, read as the
   * organization's auditor: every named section must be present and non-empty.
   */
  | {
      kind: 'audit_trace';
      organization: string;
      requires: readonly (
        | 'request'
        | 'evidence'
        | 'derivedEvidence'
        | 'policy'
        | 'approval'
        | 'planned'
        | 'executions'
        | 'verification'
        | 'lineage'
      )[];
      policyId?: string;
      /** The trace's policy section names a non-empty policy VERSION and the decision's matched rules include this rule@version. */
      policyVersionRecorded?: string;
      /** Every execution of an approved action ran exactly the approved arguments. */
      executionsMatchApproval?: boolean;
      /**
       * Which audit event to read: the run's approval (`apr:`, default) or the
       * first journaled step of the workflow that approval started (`wfs:`).
       */
      event?: 'approval' | 'workflow_step';
      /**
       * Workflow-instance semantics of the trace: the SAME state the workflow
       * read model derives, the step / compensation timeline (each step keeps
       * its OWN recorded status; a later rollback is a `laterState`, never a
       * rewritten failure) and the deterministic reading of it.
       */
      workflow?: {
        state:
          'failed' | 'compensated' | 'partial' | 'verified' | 'completed_unverified' | 'executing';
        /** Steps that must be present (matched by tool + purpose). */
        steps?: readonly {
          tool: string;
          purpose: 'step' | 'compensation';
          status: 'succeeded' | 'failed';
          /** The step's later fate; `none` = it must carry no later state. */
          laterState?: 'compensated' | 'compensation_failed' | 'not_rolled_back' | 'none';
        }[];
        /** Exactly these tools' forward steps may be reported failed (an executed step is never re-labelled failed). */
        failedOnly?: readonly string[];
        /** The trace's note must contain each of these texts. */
        noteIncludes?: readonly string[];
        /** The trace reports (or, when `false`, must NOT report) a rollback statement. */
        rollbackSummary?: boolean;
      };
      /**
       * Composite-approval attribution: the unit approval authorized the
       * composite (approvalScope `composite_workflow`), every inner execution
       * references it and names the approver only as `authorized_the_composite`,
       * the approver is never the executor / actor, and requester ≠ approver.
       */
      composite?: {
        requester: string;
        approver: string;
        /** The agent that executed for the requester (absent = the requester executed). */
        agent?: string;
      };
    }
  /**
   * Write requests (non-GET) that reached an external provider fixture of an
   * organization — proves a hostile tool response triggered no further write.
   * Harness-only: provider fixtures exist only in the in-memory evaluation.
   */
  | { kind: 'connector_writes'; organization: string; provider: 'github'; equals: number }
  /**
   * Counts runtime observability runs (`runtime_runs`) of an organization that
   * match every stated attribute (Prompt 7). Every attribute reads a run the
   * REAL runtime persisted — never a constructed metric. Durations are only
   * ever compared through booleans (never exact values), so a check is
   * deterministic.
   */
  | {
      kind: 'runtime';
      organization: string;
      status?: string;
      origin?: string;
      failureStage?: string;
      failureCode?: string;
      failureClass?: string;
      /** Stages that must have recorded timing (unused stages must be ABSENT, never zero). */
      stagesPresent?: readonly string[];
      stagesAbsent?: readonly string[];
      /** Exact number of tool calls the run recorded (only tools that actually ran). */
      toolCalls?: number;
      /** The run's first recorded tool: its status / id / attempt count / retry count. */
      toolStatus?: string;
      toolId?: string;
      toolAttempts?: number;
      toolRetries?: number;
      /** The first tool call has a measured (> 0) duration and a stage timing. */
      toolTimed?: boolean;
      /** The first model call has a measured (> 0) duration. */
      modelTimed?: boolean;
      /** Tool calls are recorded in start order and every duration is a finite number ≥ 0. */
      toolsOrdered?: boolean;
      /** Model call facts (the run's first model call). */
      modelCalls?: number;
      provider?: string;
      execution?: 'local' | 'cloud';
      modelStatus?: 'succeeded' | 'failed';
      modelErrorCode?: string;
      narrationSource?: 'model' | 'deterministic' | 'fallback';
      /** Whether the provider REPORTED token usage (false = unknown, never estimated). */
      usageAvailable?: boolean;
      /** `tokenUsage.available` for the run. */
      tokensAvailable?: boolean;
      /** Whether the run's estimated cost is null (unpriced). */
      costNull?: boolean;
      /** The model call carries prompt-template id + version and input/output fingerprints. */
      promptFingerprints?: boolean;
      /** Approval facts: the run carries an approval of this state. */
      approvalState?: 'opened' | 'resumed' | 'expired';
      /** The approval wait was measured and is at least this long. */
      approvalWaitAtLeastMs?: number;
      /** The run's own latency is SHORTER than the human approval wait (wait is not execution time). */
      durationBelowApprovalWait?: boolean;
      /** Policy decision recorded on the run. */
      policyOutcome?: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
      /** Whether the run has an HTTP request id. */
      hasRequestId?: boolean;
      /** Every recorded tool invocation id has a lineage EXECUTION record under the SAME run id. */
      correlatedToLineage?: boolean;
      /** No secret pattern / forbidden key / prompt or message text appears anywhere in the record. */
      noSensitive?: boolean;
      equals?: number;
      atLeast?: number;
    }
  /**
   * What an OPERATOR sees over the real HTTP surface (`/api/ops/runtime/*`)
   * — authorization, tenant isolation and safe exposure of run telemetry.
   */
  | {
      kind: 'runtime_operator';
      /** The organization whose runs are being looked up. */
      organization: string;
      /** The organization whose AUDITOR reads (the world's auditor of that organization). */
      readerOrganization: string;
      assert:
        /** The reader's run list contains none of `organization`'s runs (and forging its id is 403). */
        | 'list_hides_foreign'
        /** Another tenant's run id is a 404 identical to a never-existing id. */
        | 'detail_not_found'
        /** The detail body carries no secret / forbidden key / prompt or message text. */
        | 'detail_safe'
        /** The detail names this tool as the slowest call. */
        | 'detail_bottleneck_tool';
      tool?: string;
    }
  /** The recorded outcome of an `http` / `decide` step (by label). */
  | {
      kind: 'probe';
      label: string;
      /** The expected HTTP status (any of, when a list). */
      status: number | readonly number[];
      /** The expected `error.code` of the body. */
      errorCode?: string;
      /** Strings the response body must NOT contain (a config value must never be echoed). */
      bodyExcludes?: readonly string[];
      /** Strings the response body MUST contain (e.g. a stable refusal code inside a 200 run outcome). */
      bodyIncludes?: readonly string[];
    }
  /**
   * Two recorded history reads: every version in `earlier` is byte-identical
   * in `later` (history is append-only — never rewritten).
   */
  | { kind: 'probe_history'; earlier: string; later: string }
  /**
   * The stored versions of an organization policy (ground truth, read from
   * the append-only store): the exact count, and — with `integrity` —
   * consecutive numbering and a configuration hash that matches its config.
   */
  | {
      kind: 'policy_versions';
      organization: string;
      policyId: string;
      equals: number;
      integrity?: boolean;
    }
  /**
   * The run's first approval as the approval store holds it (trusted state).
   */
  | {
      kind: 'approval';
      status?: string;
      /** Whether a decision was recorded at all. */
      decided?: boolean;
      /** The user key that decided. */
      decidedBy?: string;
      requiredApproverRoleId?: string;
      separationOfDuties?: boolean;
      /** The approval's stored policy rules contain / never contain this text (`ID@version`). */
      policyRulesInclude?: string;
      policyRulesExclude?: string;
      /** `expiresAt` is at or before the harness approval clock (it can no longer be decided). */
      expired?: boolean;
    }
  /**
   * Actor continuity of the run's first approval (Prompt 9): the approval
   * store, the append-only lineage, the runtime run's governance block and
   * the Audit decision trace must ALL agree on who requested, which agent
   * acted, who approved and who executed — and the approver must never
   * appear as an actor or executor anywhere. Every source is read from what
   * the real platform persisted / answers (never constructed).
   */
  | {
      kind: 'actor_continuity';
      /** The requesting user key — the actor and executor of every record. */
      requester: string;
      /** The approving user key (distinct from the requester). Absent = no approver may be recorded. */
      approver?: string;
      /** The agent entity key that acted for the requester. Absent = no agent may appear. */
      agent?: string;
      executionAuthority: 'requester_rbac' | 'agent_delegation';
      /**
       * Also read the decision trace as this user in their own workspace (e.g. a
       * Legal reader holding audit.read): an independent persona must be able
       * to reconstruct the same continuity.
       */
      traceReader?: { user: string; workspace: string };
    }
  /**
   * The verification lineage recorded for a tool: whether it verified and —
   * the point — the SOURCE it declared (`state_readback`, `provider_readback`,
   * `response_shape`, `handler_result`), so a tool can never claim a read-back
   * it did not perform.
   */
  | {
      kind: 'verification';
      organization: string;
      tool: string;
      verified: boolean;
      source: 'state_readback' | 'provider_readback' | 'response_shape' | 'handler_result';
      /** Whether the record carries a stated limitation (weaker sources must). */
      limitation?: boolean;
      /** Exactly this many matching VERIFICATION records (default: at least one, and no record with another source/verdict). */
      equals?: number;
    }
  /**
   * Expenses of a workspace as the finance store holds them: the exact
   * persisted amount (optionally equal to the amount the APPROVAL stored),
   * status and actors.
   */
  | {
      kind: 'expense';
      organization: string;
      workspace: string;
      /** Exact-match description filter (world/request data). */
      description?: string;
      status?: 'submitted' | 'approved' | 'rejected';
      amountMinorUnits?: number;
      /** The expense amount equals the amount in the approved input of the run's first approval. */
      matchesApprovedInput?: boolean;
      submittedBy?: string;
      decidedBy?: string;
      equals: number;
    }
  /**
   * A budget's computed utilization (approved expenses only): the change from
   * the world's seeded baseline must equal `spentDeltaMinorUnits`.
   */
  | { kind: 'budget_utilization'; budget: string; spentDeltaMinorUnits: number }
  /**
   * The tool catalogs an AI model / MCP client can see — over the real
   * surfaces (the business agent's capabilities and the MCP tool list).
   * No id may contain a forbidden fragment, and every `attempt` (an MCP tool
   * name a client might guess) must be refused as an unknown tool.
   */
  | {
      kind: 'tool_catalog';
      actor: string;
      workspace: string;
      forbiddenFragments: readonly string[];
      attempt?: readonly string[];
    }
  | {
      kind: 'problem_status';
      signalId: string;
      organization: string;
      equals?: string;
      not?: string;
    }
  | {
      kind: 'plan';
      status?: string;
      outcome?: 'resolved' | 'unresolved';
      minReplans?: number;
    };

/** Matches one unified Audit Center event (`GET /api/audit/events`). */
export interface AuditEventMatcher {
  /** Which organization's audit trail (defaults to the request's organization). */
  organization?: string;
  source: 'agent_execution' | 'approval' | 'workflow_step' | 'activity';
  /** Raw lifecycle status (e.g. `completed`, `rejected`, `failed`). */
  status?: string;
  /**
   * The executable capability the event concerns. Resolved by the runner
   * through ids it observed (approval id ↔ `apr:<id>`), never by display text.
   */
  capability?: string;
  /** A world data value (entity name/title) the event's object/action/detail must mention. */
  mentions?: string;
  /**
   * Read the audit trail scoped to this workspace (defaults to the
   * organization's auditor workspace). Workspace-scoped events — such as a
   * blocked AI action — are only visible in their own workspace.
   */
  workspace?: string;
  /**
   * For a REQUIRED matcher: exactly this many matching events must exist
   * (default: at least one). Proves an event is published once, not per retry.
   */
  exactly?: number;
}

/** A fact the response must state — a value from the world data. */
export interface FactExpectation {
  /** The fact as it appears in the world data (matched case-insensitively). */
  value: string;
  /** Why this fact is expected (documentation only). */
  because: string;
}

export interface ScenarioExpectations {
  /** The expected intent class, and the primary capability for acting intents. */
  intent: { kind: IntentKind; capability?: string };
  /** The authorization decision the platform must reach. */
  authorization: { outcome: 'allowed' | 'denied'; httpStatus?: number; errorCode?: string };
  /** Retrieved grounding context (entity keys of articles/documents). */
  retrieval?: { required: readonly string[]; forbidden: readonly string[] };
  /** Tool selection: tools that must be planned/invoked, and tools that must never be. */
  tools: { expected: readonly string[]; forbidden: readonly string[] };
  /** The approval policy the platform must apply. */
  approval: {
    required: boolean;
    sideEffectClass?: 'read_only' | 'state_change' | 'consequential';
  };
  /** The execution outcome (after any approval decision). */
  execution: { outcome: 'succeeded' | 'failed' | 'not_executed' };
  /**
   * Post-conditions over persisted state. `verified` = the intended effect is
   * durably present; `unverified` = the platform must NOT report the effect
   * as achieved (e.g. remediation whose condition persists).
   */
  verification: {
    outcome: 'verified' | 'unverified' | 'not_applicable';
    checks: readonly StateCheck[];
  };
  /** Audit journal rows that must (and must not) exist afterwards. */
  audit: { required: readonly AuditEventMatcher[]; forbidden: readonly AuditEventMatcher[] };
  /** Grounded-response characteristics (never exact text). */
  response?: {
    requiredFacts: readonly FactExpectation[];
    /** World values that must never appear (other tenants' data, injected payloads). */
    forbiddenValues: readonly string[];
    /** The response must acknowledge the failure/refusal instead of claiming success. */
    acknowledgesFailure?: boolean;
    /** The maximum tolerated unsupported-claim rate (0 for every v1 scenario). */
    maxUnsupportedClaimRate: number;
  };
  /** Optional latency budget for the whole scenario (reported, not part of task success). */
  latencyBudgetMs?: number;
}

/** Per-scenario pass/fail metric keys (see metrics.ts). */
export const METRIC_KEYS = [
  'intentCorrectness',
  'authorizationCorrectness',
  'approvalPolicyCorrectness',
  'toolSelectionCorrectness',
  'retrievalCorrectness',
  'groundingCorrectness',
  'executionSuccess',
  'verificationSuccess',
  'auditCompleteness',
] as const;

/** A per-scenario pass/fail metric key. */
export type MetricKey = (typeof METRIC_KEYS)[number];

/**
 * A documented, EXPECTED gap: the platform currently fails these metrics for
 * a known reason. The scenario reports `known_gap` instead of `failed`; if
 * the platform starts passing, the report flags `knownGapResolved` so the
 * dataset is updated (the gap never silently hides a regression elsewhere).
 */
export interface KnownGap {
  metrics: readonly MetricKey[];
  reason: string;
  /** Where the gap lives (file paths). */
  references: readonly string[];
}

/** One versioned scenario. */
export interface ScenarioDefinition {
  /** Stable id, e.g. `NXS-001`. Never reused. */
  id: string;
  /** Scenario revision (bump when expectations change). */
  revision: number;
  title: string;
  category: ScenarioCategory;
  /** Business domain (e.g. `projects`, `finance`, `people`). */
  domain: string;
  description: string;
  /** Free-form tags; `safety` marks scenarios counted by the safety gate. */
  tags: readonly string[];
  /** The world this scenario runs in (base world + scenario-specific fixtures). */
  world: ScenarioWorld;
  /** The organization the scenario is about (audit default, reporting). */
  organization: string;
  /** The workspace the scenario is about (reporting). */
  workspace?: string;
  request: ScenarioRequest;
  expected: ScenarioExpectations;
  /**
   * A model provider fixture (an upstream HTTP server the REAL adapter and
   * transport talk to). Absent = the deterministic composer narrates (no model).
   */
  modelFixture?: ModelFixture;
  knownGap?: KnownGap;
}

/**
 * A deterministic upstream model endpoint. The runtime uses its real adapter
 * (`local` → Ollama-compatible, `cloud` → the hosted Groq adapter) over real
 * HTTP against it; only the far end is a fixture.
 */
export interface ModelFixture {
  execution: 'local' | 'cloud';
  /** `ok` reports token usage; `no_usage` omits it; `error` fails with HTTP 500. */
  behavior: 'ok' | 'no_usage' | 'error';
}

/** A versioned scenario dataset. */
export interface ScenarioDataset {
  id: string;
  version: string;
  schemaVersion: string;
  description: string;
  scenarios: readonly ScenarioDefinition[];
}
