/**
 * @nexora/ai-runtime — context.
 *
 * The context assembly layer (AIR.md §1.2 R5 Context Manager, §7 stage 2).
 * A minimal, permission-filtered context is assembled for every AI
 * interaction: actor, workspace, permissions, and conversation. Contexts are
 * plain data objects (no behavior) so they serialize cleanly for audit and
 * explainability (AIR.md §14). The Agent SDK's per-execution contexts are
 * consumed at the agent boundary; these are the orchestrator's view.
 */

import type { AutonomyTier } from '@nexora/contracts/ai';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import { nowIso } from '@nexora/shared/time';

/** The acting user. */
export interface UserContext {
  /** The user id. */
  userId: string;
  /** Display name, when known. */
  displayName?: string;
  /** Roles held by the user (for policy evaluation). */
  roles?: readonly string[];
}

/** The tenant (company) the interaction belongs to. */
export interface OrganizationContext {
  /** The tenant (company) id. */
  tenantId: TenantId;
  /** Company name, when known. */
  name?: string;
}

/** The workspace the interaction belongs to. */
export interface WorkspaceContext {
  /** The workspace id. */
  workspaceId: WorkspaceId;
  /** Workspace name, when known. */
  name?: string;
}

/** The immutable scope of one AI run. */
export interface ExecutionContext {
  /** Run id (`run_...`). */
  runId: string;
  /** Tenant (company) scope. */
  tenantId: TenantId;
  /** Workspace scope, when workspace-scoped. */
  workspaceId?: WorkspaceId;
  /** The invoking user id. */
  userId: string;
  /** Conversation id the run belongs to, when present. */
  conversationId?: string;
  /** ISO-8601 UTC time the run started. */
  startedAt: string;
}

/** A message in the conversation view handed to the orchestrator. */
export interface ContextMessage {
  /** Message role. */
  role: 'user' | 'assistant' | 'system';
  /** Message content. */
  content: string;
}

/** The conversation view of a run (read-only history). */
export interface ConversationContext {
  /** Conversation id. */
  conversationId: string;
  /** The user the conversation belongs to. */
  userId: string;
  /** Message history (read-only view). */
  history: readonly ContextMessage[];
}

/**
 * The permission context of a run: what the invoking user may do, and the
 * autonomy tier the workspace grants the runtime. Drives permission-filtered
 * discovery (PRM-8) and approval gating (BR-13).
 */
export interface PermissionContext {
  /** The invoking user id. */
  userId: string;
  /** Autonomy tier granted for this interaction (AIX-14/15). */
  autonomyTier: AutonomyTier;
  /** Actions the user is explicitly allowed to perform, when scoped. */
  allowedActions?: readonly string[];
  /** Roles held (for policy evaluation). */
  roles?: readonly string[];
}

/** The complete, minimal context of an AI interaction. */
export interface AIContext {
  /** The run scope. */
  execution: ExecutionContext;
  /** The acting user. */
  user: UserContext;
  /** The tenant (company). */
  organization: OrganizationContext;
  /** The workspace, when workspace-scoped. */
  workspace?: WorkspaceContext;
  /** Effective permissions for this interaction. */
  permissions: PermissionContext;
  /** The conversation view, when present. */
  conversation?: ConversationContext;
}

/** Inputs to {@link buildAIContext}. */
export interface BuildAIContextInput {
  /** The run scope (`startedAt` is stamped when absent). */
  execution: Omit<ExecutionContext, 'startedAt'> & { startedAt?: string };
  /** The acting user. */
  user: UserContext;
  /** The tenant (company). */
  organization: OrganizationContext;
  /** The workspace, when workspace-scoped. */
  workspace?: WorkspaceContext;
  /** Effective permissions for this interaction. */
  permissions: PermissionContext;
  /** The conversation view, when present. */
  conversation?: ConversationContext;
}

/** Builds an {@link AIContext}, stamping the run start time when absent. */
export function buildAIContext(input: BuildAIContextInput): AIContext {
  return {
    execution: {
      ...input.execution,
      startedAt: input.execution.startedAt ?? nowIso(),
    },
    user: input.user,
    organization: input.organization,
    workspace: input.workspace,
    permissions: input.permissions,
    conversation: input.conversation,
  };
}

/**
 * Validates the minimum invariants of an {@link AIContext}. Returns a list
 * of field issues; an empty list means the context is valid.
 */
export function validateAIContext(
  context: AIContext,
): readonly { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (context.execution.runId.length === 0) {
    issues.push({ path: 'execution.runId', message: 'Run id is required' });
  }
  if (context.execution.tenantId.length === 0) {
    issues.push({ path: 'execution.tenantId', message: 'Tenant id is required' });
  }
  if (context.execution.userId.length === 0) {
    issues.push({ path: 'execution.userId', message: 'User id is required' });
  }
  if (context.user.userId.length === 0) {
    issues.push({ path: 'user.userId', message: 'User id is required' });
  }
  if (context.organization.tenantId.length === 0) {
    issues.push({ path: 'organization.tenantId', message: 'Tenant id is required' });
  }
  if (context.execution.tenantId !== context.organization.tenantId) {
    issues.push({
      path: 'organization.tenantId',
      message: 'Organization tenant must match the execution tenant',
    });
  }
  if (Number.isNaN(Date.parse(context.execution.startedAt))) {
    issues.push({
      path: 'execution.startedAt',
      message: 'StartedAt must be a parseable ISO timestamp',
    });
  }
  return issues;
}
