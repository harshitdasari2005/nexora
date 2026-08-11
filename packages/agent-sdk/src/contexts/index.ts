/**
 * @nexora/agent-sdk — contexts.
 *
 * Typed context objects threaded through every agent execution. Contexts
 * carry scope (tenant/company/workspace), conversation state, and the
 * per-phase views (execution, planning, reasoning, memory, knowledge,
 * policy, approval). They are plain data objects — no behavior — so they
 * serialize cleanly for audit and explainability.
 */

import type { AgentId, ExecutionId } from '../types/index.js';

/**
 * Tenant (company) scope of an execution. Plain string to keep the SDK
 * provider-friendly; the canonical branded `TenantId` lives in
 * `@nexora/contracts/common`.
 */
export interface TenantContext {
  /** The tenant (company) id. */
  tenantId: string;
}

/** Company scope — an alias view over the tenant id (companies are tenants). */
export interface CompanyContext {
  /** The company (tenant) id. */
  companyId: string;
}

/** Workspace scope of an execution, when workspace-scoped. */
export interface WorkspaceContext {
  /** The workspace id. */
  workspaceId: string;
}

/** The user-facing conversation this execution belongs to, when present. */
export interface ConversationContext {
  /** Conversation id. */
  conversationId: string;
  /** The user id the conversation belongs to. */
  userId: string;
  /** Message history captured so far (read-only view). */
  history: readonly { role: 'user' | 'assistant' | 'system'; content: string }[];
}

/** Scope context combining tenant, company, and workspace. */
export interface ScopeContext
  extends TenantContext, Partial<CompanyContext>, Partial<WorkspaceContext> {}

/** The immutable scope of a single execution. */
export interface ExecutionContext extends ScopeContext {
  /** Execution id. */
  executionId: ExecutionId;
  /** Agent id performing the execution. */
  agentId: AgentId;
  /** The user conversation this execution belongs to, when present. */
  conversation?: ConversationContext;
  /** ISO-8601 UTC time the execution started. */
  startedAt: string;
}

/** The planning view of an execution. */
export interface PlanningContext {
  /** The user intent to plan for. */
  intent: string;
  /** Constraints the plan must respect (e.g. approved tool ids). */
  constraints?: readonly string[];
}

/** The reasoning view of an execution. */
export interface ReasoningContext {
  /** The question or decision being reasoned about. */
  question: string;
}

/** The memory view of an execution (read/write handles). */
export interface MemoryContext {
  /** Whether the agent may read agent memory. */
  canRead: boolean;
  /** Whether the agent may write to agent memory. */
  canWrite: boolean;
}

/** The knowledge view of an execution. */
export interface KnowledgeContext {
  /** Knowledge scopes the agent may query (AIR.md §9.3). */
  allowedScopes: readonly string[];
}

/** The policy view of an execution. */
export interface PolicyContext {
  /** Policy ids already evaluated for this execution. */
  appliedPolicyIds: readonly string[];
}

/** The approval view of an execution. */
export interface ApprovalContext {
  /** Whether this execution requires human approval (AIR.md §12). */
  requiresApproval: boolean;
  /** Approver role(s) required, when approval is required. */
  approverRoles?: readonly string[];
}

/** The complete context bag handed to an execution. */
export interface AgentContext {
  /** The execution scope. */
  execution: ExecutionContext;
  /** The planning view. */
  planning: PlanningContext;
  /** The reasoning view. */
  reasoning: ReasoningContext;
  /** The memory view. */
  memory: MemoryContext;
  /** The knowledge view. */
  knowledge: KnowledgeContext;
  /** The policy view. */
  policy: PolicyContext;
  /** The approval view. */
  approval: ApprovalContext;
}

/**
 * Validates that an execution context satisfies the minimum invariants:
 * a tenant id, a valid execution id, a valid agent id, and a parseable
 * start time.
 *
 * @returns a list of field issues; empty when the context is valid.
 */
export function validateExecutionContext(
  context: ExecutionContext,
): readonly { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (context.tenantId === undefined || context.tenantId.length === 0) {
    issues.push({ path: 'tenantId', message: 'Tenant id is required' });
  }
  if (context.executionId === undefined || context.executionId.length === 0) {
    issues.push({ path: 'executionId', message: 'Execution id is required' });
  }
  if (context.agentId === undefined || context.agentId.length === 0) {
    issues.push({ path: 'agentId', message: 'Agent id is required' });
  }
  if (Number.isNaN(Date.parse(context.startedAt))) {
    issues.push({ path: 'startedAt', message: 'StartedAt must be a parseable ISO timestamp' });
  }
  return issues;
}
