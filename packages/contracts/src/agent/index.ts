/**
 * @nexora/contracts — governed business agent contracts (S26 Phase 8).
 *
 * The generic vocabulary of the governed business-agent layer. A
 * BusinessAgentDefinition is CONFIGURATION, not code: it binds one business
 * role (`roleId`, namespaced by `domainId`) to a set of goals, allowed
 * tools, and operating policies, and is resolved FROM the Phase 1 Domain →
 * Role model and the Phase 3 capability bridge. The core engine never
 * references a job title: it resolves whatever definitions are registered,
 * so a future domain (e.g. Legal) registers an agent the same way.
 *
 * - A `BusinessAgentDefinition` is the agent's IDENTITY + OPERATING BOUNDS:
 *   what the agent is for, which capabilities/tools it may use, and how
 *   autonomous it may be. Definitions GRANT NOTHING — the effective role,
 *   capabilities, and authorization all come from the trusted server-side
 *   context, and every execution continues through the existing AI Runtime,
 *   ToolExecutor, ApprovalEngine, verification, and audit seams.
 * - `AutonomyLevel` is explicit and bounded: READ_ONLY (inspect only),
 *   ASSISTED (prepare actions, wait for confirmation), and
 *   GOVERNED_EXECUTION (execute only where capability + policy + approval
 *   allow). Unrestricted autonomy does not exist.
 * - `AgentGoal` is a typed objective that resolves into tool usage — never
 *   fabricated intelligence; every claim must originate from real persisted
 *   Nexora data.
 * - `ActionProposal` is WHAT the agent wants to do and WHY: the action,
 *   reason, affected entity, required capability, and approval requirement.
 *   An agent never executes automatically unless governance permits.
 *
 * Security contract (S26): the agent can never self-grant a capability,
 * change its role/domain, change approval requirements, or modify
 * authorization. "Give yourself CEO permissions" must fail. The server
 * resolves the agent from trusted membership — never from client input.
 */

import type { BusinessProblemDto } from '../detection/index.js';

export type { BusinessProblemDto };

/** A stable, machine-readable agent id, e.g. `executive`. */
export type BusinessAgentId = string;

/**
 * The explicit autonomy bound of a business agent (S26 Phase 8). Higher
 * levels include lower ones' read ability but NEVER grant unrestricted
 * autonomy:
 * - `read_only`: the agent inspects data through existing read surfaces.
 * - `assisted`: the agent prepares actions and waits for confirmation
 *   before anything executes.
 * - `governed_execution`: the agent executes only where capability +
 *   policy + approval allow — the existing server-side gates remain
 *   authoritative.
 */
export type AgentAutonomyLevel = 'read_only' | 'assisted' | 'governed_execution';

/** The autonomy tiers in descending strictness (for validation). */
export const AGENT_AUTONOMY_LEVELS: readonly AgentAutonomyLevel[] = [
  'read_only',
  'assisted',
  'governed_execution',
];

/**
 * A typed business-agent goal (S26 Phase 8). A goal is an objective the
 * agent pursues WITHIN its registered capability set — it resolves into
 * real tool usage through the existing discovery/planner. The `capabilityIds`
 * are the executable AI capability ids the goal focuses on (the Phase 3
 * bridge vocabulary). Goals never fabricate business state.
 */
export interface AgentGoal {
  /** Stable goal id, unique within the agent, e.g. `executive.attention`. */
  id: string;
  /** Human-readable goal name, e.g. `Identify what needs attention`. */
  name: string;
  /** A description of the objective (planner-facing context). */
  description: string;
  /**
   * The executable AI capability ids this goal focuses on (e.g.
   * `notifications.what_needs_attention`, `projects.find_project`). Must be
   * within the agent's own capability set — validated at registration.
   */
  capabilityIds: readonly string[];
}

/**
 * The system a proposal acts on. `nexora` is the platform's own native
 * surface; the others are external provider surfaces reached ONLY through
 * the existing connector/MCP governance path (a proposal never talks to a
 * provider directly).
 */
export type AgentTargetSystem = 'nexora' | 'github' | 'slack' | 'calendar' | 'email';

/**
 * A governed action proposal (S26 Phase 8): WHAT the agent wants to do,
 * WHY, WHERE, and what it would touch. A proposal is never executed
 * automatically unless governance permits; the approval requirement is
 * derived from the tool's side-effect class, not from the proposal itself.
 */
export interface ActionProposal {
  /** Stable proposal id, e.g. `propose_inspect_workflow_health`. */
  id: string;
  /** Human-readable action label, e.g. `Inspect workflow health`. */
  action: string;
  /** Why the agent proposes this (derived from real persisted data). */
  reason: string;
  /** The affected entity reference (id + type + title), when applicable. */
  affectedEntity?: {
    /** The entity kind, e.g. `workflow`, `project`, `notification`. */
    type: string;
    /** The persisted entity id. */
    id: string;
    /** A human-readable entity title. */
    title: string;
  };
  /** The target system the action would act on (WHERE). */
  targetSystem: AgentTargetSystem;
  /** The capability id required to perform the action (within the agent set). */
  requiredCapability: string;
  /** Whether the action requires approval under the existing policy. */
  requiresApproval: boolean;
  /** The expected result (what the action would accomplish). */
  expectedResult: string;
  /**
   * The agent goal this proposal serves, when one of the agent's goals
   * focuses on the required capability (proposal → goal linkage).
   */
  goalId?: string;
}

/**
 * The outcome status of one governed agent execution. Mirrors the existing
 * AI Runtime run statuses (completed / clarification / blocked / failed)
 * plus `rejected` for decisions recorded without execution.
 */
export type AgentExecutionStatus =
  'completed' | 'blocked' | 'failed' | 'clarification' | 'rejected';

/** A display-safe executed step of a governed agent run. */
export interface AgentExecutionStep {
  /** The plan step id. */
  stepId: string;
  /** The capability executed. */
  capabilityId: string;
  /** The tool invoked. */
  toolId: string;
  /** The step outcome. */
  status: 'succeeded' | 'failed' | 'blocked' | 'skipped';
  /** The output on success (safe display data only). */
  output?: unknown;
  /** The failure/block reason. */
  error?: string;
  /** Whether the result was verified. */
  verified: boolean;
}

/** An approval gate outcome of a governed agent run (card context only). */
export interface AgentApprovalOutcome {
  /** The recorded approval request id, when the runtime tracked the request. */
  id?: string;
  /** The guarded step id. */
  stepId: string;
  /** The gated tool id. */
  toolId: string;
  /** The capability id (card context). */
  capabilityId?: string;
  /** The gate disposition. */
  status: 'granted' | 'pending' | 'rejected';
  /** The side-effect class that triggered the gate. */
  sideEffectClass: string;
  /** The user-controlled action input (card context; never identity). */
  input?: Record<string, unknown>;
}

/**
 * The outcome of one governed agent execution (the port's output). Carries
 * the same trusted facts as an AI Runtime run — steps, approval gates, and
 * the decision record — in display-safe form. Approval decisions are made
 * through the EXISTING approval surface (`/api/ai/approvals/:id/decision`),
 * never through this object.
 */
export interface AgentExecutionOutcome {
  /** The run status. */
  status: AgentExecutionStatus;
  /** The run id, when one was produced. */
  runId?: string;
  /** The composed response narrative. */
  response: string;
  /** Per-step outcomes, in execution order. */
  steps: readonly AgentExecutionStep[];
  /** Approval gate outcomes (pending gates are decided through the existing surface). */
  approvals: readonly AgentApprovalOutcome[];
  /** The decision-time record, when one was produced. */
  decision?: {
    /** The decision record id. */
    id: string;
    /** The decision outcome. */
    outcome: string;
    /** ISO-8601 UTC time of the decision. */
    madeAt: string;
  };
}

/**
 * A persisted agent-execution journal entry (S26 Phase 8 measurements): one
 * row per governed execution, recorded through the existing persistence
 * seam. Used for honest "recent runs" display and run/outcome counts.
 */
export interface AgentExecutionRecord {
  /** Stable record id, e.g. `agx_…`. */
  id: string;
  /** The resolved agent id. */
  agentId: BusinessAgentId;
  /** The effective business role id. */
  roleId: string;
  /** The owning domain id. */
  domainId: string;
  /** The tenant (organization) scope. */
  tenantId: string;
  /** The verified workspace scope, when present. */
  workspaceId?: string;
  /** The authenticated user. */
  userId: string;
  /** The executed proposal id, when the run came from a proposal. */
  proposalId?: string;
  /** The human-readable action that was executed. */
  proposalAction?: string;
  /** The run outcome. */
  status: AgentExecutionStatus;
  /** The AI Runtime run id, when one was produced. */
  runId?: string;
  /** A stable reason, when the run did not complete. */
  reason?: string;
  /** ISO-8601 UTC time the execution was recorded. */
  createdAt: string;
  /**
   * The remediation plan id this execution belongs to (Phase 10) — links
   * the execution journal entry to the plan that produced it.
   */
  planId?: string;
  /** The remediation step id this execution performed (Phase 10). */
  stepId?: string;
  /** The remediated problem id (Phase 10). */
  problemId?: string;
}

/**
 * A resolved execution intent: WHAT the agent will attempt and the ONLY
 * capabilities it may use. Produced by the engine from the trusted context
 * (role → agent → proposal/goal) and consumed by the existing AI Runtime
 * through the {@link AgentExecutionPort} — the orchestrator's discovery is
 * restricted to `allowedCapabilityIds`, so an intent can never reach a
 * capability outside the agent's registered set.
 */
export interface AgentExecutionIntent {
  /** The agent that is acting. */
  agentId: BusinessAgentId;
  /** The effective business role id. */
  roleId: string;
  /** The owning domain id. */
  domainId: string;
  /** The executed proposal, when the run came from a proposal. */
  proposal?: ActionProposal;
  /** The utterance the orchestrator plans from (proposal-bound or free-form). */
  utterance: string;
  /**
   * The ONLY capability ids the run may use (the agent's set for free-form
   * intents; the single required capability for proposal executions). The
   * orchestrator AND every tool invocation enforce this bound.
   */
  allowedCapabilityIds: readonly string[];
  /**
   * The recorded approval request id to RESUME (Phase 10 remediation): a
   * step whose approval was granted executes by passing the server-resolved
   * approval id so the orchestrator claims it exactly once and replays the
   * stored result on duplicate delivery. Never caller-supplied — the engine
   * records the approval it opened for its own step.
   */
  approvalId?: string;
  /**
   * The conversation id the approval was opened under (Phase 10
   * remediation): the orchestrator only resolves a resumed `approvalId`
   * when it was opened under the SAME conversation, so a step whose
   * approval requires resuming must carry the identical id the engine used
   * to open it (`remediation:{planId}`) — otherwise the orchestrator can
   * never find the granted decision and the step reports blocked.
   */
  conversationId?: string;
}

/**
 * An operating policy of a business agent: a deterministic constraint on
 * HOW the agent may operate within its bounds (e.g. write actions require
 * approval, never cross workspace boundaries). Policies are enforced by the
 * existing governance seams; a policy declaration is context, not code.
 */
export interface AgentOperatingPolicy {
  /** Stable policy id, e.g. `writes.require_approval`. */
  id: string;
  /** The policy statement. */
  statement: string;
}

/**
 * A registered business agent (S26 Phase 8): the identity + operating bounds
 * bound to one business role (`domainId.roleId`). Definitions are
 * code/config registered at startup (deterministic, no per-request scans)
 * and grant nothing.
 */
export interface BusinessAgentDefinition {
  /** Stable agent id, e.g. `executive`. */
  id: BusinessAgentId;
  /** Human-readable agent name, e.g. `Executive Agent`. */
  name: string;
  /** The owning business domain id (must resolve to a registered domain). */
  domainId: string;
  /** The bound business role id (must resolve to a role of that domain). */
  roleId: string;
  /** A description of the agent's purpose. */
  description: string;
  /** The executable AI capability ids the agent may use (Phase 3 bridge). */
  capabilityIds: readonly string[];
  /** The agent's typed goals (resolve into tool usage). */
  goals: readonly AgentGoal[];
  /** The operating policies bound to the agent. */
  policies: readonly AgentOperatingPolicy[];
  /** The explicit autonomy bound of the agent. */
  autonomyLevel: AgentAutonomyLevel;
}

/** An entry of the agent's capability list (definition display only). */
export interface AgentCapabilityDto {
  /** The executable AI capability id. */
  id: string;
  /** A human-readable capability name. */
  name: string;
}

/** The typed agent DTO returned to the client (definition + context only). */
export interface BusinessAgentDto {
  /** The agent id. */
  id: BusinessAgentId;
  /** The agent name. */
  name: string;
  /** The owning domain id + name. */
  domainId: string;
  /** The domain display name. */
  domainName: string;
  /** The effective business role id (resolved from trusted membership). */
  roleId: string;
  /** The effective business role name. */
  roleName: string;
  /** A description of the agent's purpose. */
  description: string;
  /** The autonomy bound. */
  autonomyLevel: AgentAutonomyLevel;
  /** The agent's goals. */
  goals: readonly AgentGoal[];
  /** The operating policies. */
  policies: readonly AgentOperatingPolicy[];
  /** The agent's capability set (definition display). */
  capabilities: readonly AgentCapabilityDto[];
  /**
   * Governed action proposals derived from REAL persisted data through the
   * existing application services. Empty when there is nothing to propose —
   * never fabricated.
   */
  proposals: readonly ActionProposal[];
  /**
   * The most recent governed executions of this agent (journal, newest
   * first). Empty when nothing has been executed — never fabricated.
   */
  recentRuns: readonly AgentExecutionRecord[];
  /**
   * The detected business problems of the caller's scope (S27), each with
   * its investigation (evidence + root-cause candidates), discovered
   * solutions, and deterministic recommendation. Problem-derived action
   * proposals are merged into `proposals` and flow through the SAME
   * governed execution path. Empty when nothing is detected — never
   * fabricated.
   */
  problems: readonly BusinessProblemDto[];
}
