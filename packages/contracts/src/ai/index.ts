/**
 * @nexora/contracts — AI contracts.
 *
 * The AI Runtime contract vocabulary (AIR.md §3, §5): agent manifests,
 * skills, capabilities, tools, reasoning/execution/decision metadata, and
 * explainability. These drive capability discovery (AIR.md §5), the
 * approval engine (AIR.md §12), and AI observability (AIR.md §16).
 *
 * The canonical `SideEffectClass` literal mirrors the runtime
 * `SIDE_EFFECT_CLASSES` array in `@nexora/shared/constants` (keep in sync).
 */

import type { SemVer, Timestamp } from '../common/index.js';

/**
 * Side-effect classes for AI tool calls, aligned with PRODUCT_SPEC.md §9.3
 * (side-effect safety taxonomy). These drive the autonomy-tier / approval
 * decision (AIR.md §12). Runtime array: `SIDE_EFFECT_CLASSES` in
 * `@nexora/shared/constants`.
 */
export type SideEffectClass = 'read_only' | 'state_change' | 'consequential';

/**
 * Autonomy tier of a skill/agent execution (PSD.md §9.3). Higher tiers allow
 * more autonomous behavior; `consequential` actions always require approval.
 */
export type AutonomyTier = 'human_only' | 'supervised' | 'autonomous';

/**
 * The agent identity — globally unique and immutable for the agent's
 * lifetime.
 */
export interface AgentIdentity {
  /** Agent id (`agt_...`). */
  id: string;
  /** Stable name, e.g. `hr` (the owning bounded context). */
  name: string;
  /** Human-readable display name. */
  displayName: string;
}

/**
 * A tool the agent may invoke. Tools are the only way agents touch the world
 * (AIR.md §10).
 */
export interface AgentTool {
  /** Tool id, globally unique (`tool_<verb>_<noun>`). */
  id: string;
  /** Side-effect class driving approval routing (PSD.md §9.3). */
  sideEffectClass: SideEffectClass;
  /** Whether the tool is idempotent-safe to re-invoke (AIR.md §10.7). */
  idempotent: boolean;
  /** Timeout budget for the tool call, in milliseconds. */
  timeoutMs: number;
  /** JSON schema (JSON Schema) describing the input contract. */
  inputSchema: Record<string, unknown>;
}

/**
 * The tool contract a tool registry entry must satisfy (AIR.md §5 tool
 * manifest, SAD.md §10 Tool Registry).
 */
export interface ToolContract {
  /** Tool id, globally unique. */
  id: string;
  /** Human-readable description for the planner. */
  description: string;
  /** Side-effect class. */
  sideEffectClass: SideEffectClass;
  /** Whether the tool is idempotent-safe. */
  idempotent: boolean;
  /** Timeout budget, in milliseconds. */
  timeoutMs: number;
  /** Input schema (JSON Schema). */
  inputSchema: Record<string, unknown>;
}

/**
 * A skill bundles a capability with the tools and permissions to execute it.
 * Skills are the unit of capability discovery (AIR.md §5).
 */
export interface AgentSkill {
  /** Skill id, e.g. `hr.hire_employee`. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Tool ids this skill may invoke. */
  toolIds: readonly string[];
  /** Autonomy tier allowed for this skill. */
  autonomyTier: AutonomyTier;
  /** Whether executing this skill requires human approval. */
  requiresApproval: boolean;
}

/**
 * The skill contract a skill registry entry must satisfy (AIR.md §5 skill
 * manifest).
 */
export interface SkillContract {
  /** Skill id, e.g. `hr.hire_employee`. */
  id: string;
  /** Skill name. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Capability ids the skill implements. */
  capabilityIds: readonly string[];
  /** Tool ids the skill may invoke. */
  toolIds: readonly string[];
  /** Autonomy tier. */
  autonomyTier: AutonomyTier;
  /** Whether execution requires human approval. */
  requiresApproval: boolean;
}

/**
 * A capability registered by an app/plugin for AI discovery (AIR.md §5). The
 * Enterprise AI Orchestrator discovers capabilities from manifests — it never
 * hardcodes applications (SAD.md §10).
 */
export interface CapabilityDeclaration {
  /** Capability id, e.g. `projects.create_project`. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description for the planner (AIR.md §6). */
  description: string;
  /** Skill id that implements this capability. */
  skillId: string;
  /** Side-effect class for risk analysis (AIR.md §7.5). */
  sideEffectClass: SideEffectClass;
}

/**
 * The capability contract a capability registry entry must satisfy
 * (AIR.md §5 capability manifest).
 */
export interface CapabilityContract {
  /** Capability id, e.g. `projects.create_project`. */
  id: string;
  /** Capability name. */
  name: string;
  /** Description for the planner. */
  description: string;
  /** Skill id that implements the capability. */
  skillId: string;
  /** Side-effect class. */
  sideEffectClass: SideEffectClass;
  /** Whether the capability mutates state. */
  mutatesState: boolean;
}

/**
 * The agent manifest — the 14-element agent contract distilled to its type
 * surface (AIR.md §3). Each owning module provides the concrete values.
 */
export interface AgentManifest {
  /** Agent identity. */
  identity: AgentIdentity;
  /** Agent semantic version. */
  version: SemVer;
  /** Skill ids the agent exposes. */
  skills: readonly AgentSkill[];
  /** Tool ids the agent owns. */
  tools: readonly AgentTool[];
  /** Knowledge scopes the agent may read (AIR.md §9.3). */
  knowledgeScopes: readonly string[];
  /** Policy ids the agent is bound by (AIR.md §13). */
  policyIds: readonly string[];
  /** Event types the agent emits. */
  emittedEventTypes: readonly string[];
  /** Event types the agent subscribes to. */
  subscribedEventTypes: readonly string[];
  /** ISO-8601 UTC time the manifest was last updated. */
  updatedAt: Timestamp;
}

/**
 * Reasoning metadata — the observable record of a reasoning stage (AIR.md
 * §7): which stage, which knowledge was retrieved, and the outcome.
 */
export interface ReasoningMetadata {
  /** Reasoning stage id (intent, context, retrieval, planning, …). */
  stage: string;
  /** Knowledge item ids retrieved at this stage (with citations). */
  knowledgeUsed: readonly string[];
  /** ISO-8601 UTC time the stage completed. */
  completedAt: Timestamp;
  /** Free-form reasoning trace for explainability. */
  trace?: readonly string[];
}

/**
 * Execution metadata — the observable record of a tool/skill execution
 * (AIR.md §16 execution timeline).
 */
export interface ExecutionMetadata {
  /** Execution id. */
  id: string;
  /** Tool or skill id executed. */
  executedBy: string;
  /** ISO-8601 UTC time execution started. */
  startedAt: Timestamp;
  /** ISO-8601 UTC time execution finished, when finished. */
  finishedAt?: Timestamp;
  /** Execution outcome. */
  status: 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
  /** Retry attempt number (1-based). */
  attempt: number;
  /** Whether the execution required human approval. */
  requiredApproval: boolean;
}

/**
 * Decision metadata — the observable record of a planner decision (AIR.md
 * §6-7): what was decided, why, and with what confidence.
 */
export interface DecisionMetadata {
  /** The decision id. */
  id: string;
  /** The decision taken (e.g. which plan was selected). */
  decision: string;
  /** Alternatives considered. */
  alternativesConsidered: readonly string[];
  /** Reasons for the decision (explainability, AIR.md §14). */
  reasons: readonly string[];
  /** Model confidence, 0..1 when available. */
  confidence?: number;
  /** ISO-8601 UTC time the decision was made. */
  madeAt: Timestamp;
}

/**
 * An explainability record — every AI action must be explainable (AIR.md
 * §14, PSD.md AIX-11/19).
 */
export interface ExplanationRecord {
  /** The user intent as understood. */
  intent: string;
  /** Steps of reasoning taken. */
  reasoning: readonly string[];
  /** Knowledge items used (with citations). */
  knowledgeUsed: readonly { itemId: string; snippet: string }[];
  /** Policies applied during evaluation. */
  policiesApplied: readonly string[];
  /** Capabilities invoked. */
  capabilitiesUsed: readonly string[];
  /** Agents invoked. */
  agentsUsed: readonly string[];
  /** Tools invoked. */
  toolsUsed: readonly string[];
  /** Approvals requested/granted. */
  approvals: readonly { id: string; status: 'granted' | 'rejected' | 'pending' }[];
  /** The final decision taken. */
  finalDecision: string;
  /** Model confidence, 0..1 when available. */
  confidence?: number;
}
