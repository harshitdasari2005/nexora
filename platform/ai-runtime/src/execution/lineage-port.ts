/**
 * @nexora/ai-runtime — lineage port (Prompt 6).
 *
 * The runtime REPORTS what happened (a planned action; an actual execution
 * and its verification); the host decides how to persist it. Reporting is
 * one-way and best-effort: lineage describes trusted decisions after the
 * fact and is NEVER an input to authorization, policy or approval, so a
 * failing sink cannot change what runs or is refused (the failure is
 * swallowed and the action's own audit trail stands).
 *
 * Events carry ids, fingerprints, and — in-process only — the raw tool
 * output so the host can derive evidence; the runtime never persists raw
 * outputs itself.
 */

import type { AgentPrincipalContext } from '@nexora/contracts/agent';

/** The policy decision an event is linked to (as decided, never recomputed). */
export interface LineagePolicyRef {
  outcome: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  policyId: string;
  version: string;
  fingerprint: string;
  contextFingerprint?: string;
}

/** Scope + principal common to every lineage event (all trusted, server-side). */
export interface LineageScope {
  tenantId: string;
  workspaceId?: string;
  userId: string;
  agent?: AgentPrincipalContext;
  delegationId?: string;
  approvalId?: string;
  /**
   * The user who APPROVED the action, on runs that resume an approval
   * (Prompt 9). DESCRIPTIVE ONLY: never read by authorization, policy or
   * approval decisions. `userId` stays the REQUESTER (the actor the action
   * runs as); the approver never becomes the actor or executor.
   */
  approvedBy?: { userId: string; roleId?: string; decidedAt?: string };
  /** The run this belongs to (orchestrator run, MCP correlation id, workflow correlation id). */
  runId: string;
  origin: string;
}

/** A step the planner intends to run (before approval or execution). */
export interface PlannedActionEvent extends LineageScope {
  stepId: string;
  capabilityId: string;
  toolId: string;
  inputFingerprint: string;
  requiresApproval: boolean;
  policy?: LineagePolicyRef;
}

/** The verification detail of an executed invocation. */
export interface LineageVerification {
  verified: boolean;
  source:
    'state_readback' | 'provider_readback' | 'response_shape' | 'handler_result' | 'redetection';
  limitation?: string;
  checks: readonly { ruleId: string; passed: boolean }[];
}

/** A tool invocation that actually ran (success, failure or unverified). */
export interface ExecutionEvent extends LineageScope {
  invocationId: string;
  capabilityId: string;
  toolId: string;
  status: 'succeeded' | 'failed' | 'unverified';
  errorCode?: string;
  verified: boolean;
  attempts: number;
  startedAt: string;
  completedAt: string;
  inputFingerprint: string;
  outputFingerprint?: string;
  policy?: LineagePolicyRef;
  /**
   * How the result was verified (Prompt 9): the tool's DECLARED source
   * (default `handler_result`), the verifier's per-rule checks, and what the
   * verification does not prove.
   */
  verification?: LineageVerification;
  /** The raw tool output — in-process only, for evidence extraction; never persisted as-is. */
  output?: unknown;
  workflow?: { stepId?: string; purpose?: 'step' | 'compensation' };
}

/** Receives lineage events. Implementations must not throw into the runtime. */
export interface LineagePort {
  planned(event: PlannedActionEvent): Promise<void>;
  executed(event: ExecutionEvent): Promise<void>;
}
