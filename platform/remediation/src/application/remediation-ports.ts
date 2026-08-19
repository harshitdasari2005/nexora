/**
 * @nexora/module-remediation — remediation engine ports (Phase 10).
 *
 * The generic engine NEVER resolves identity, authorization, capabilities,
 * tools, or approvals itself: every one of those is a port implemented by
 * the API layer over the EXISTING seams (S26 membership → role → agent
 * resolution, S27 detection, the AI Runtime registry + ToolExecutor +
 * ApprovalEngine + execution journal). This module produces plans, validates
 * them, and orchestrates steps — it never executes anything directly and
 * never decides tenant/workspace/role/capability/approver.
 */

import type { AgentExecutionIntent, AgentExecutionOutcome } from '@nexora/contracts/agent';
import type { BusinessProblemDto, ProblemStatus } from '@nexora/contracts/detection';

/** The trusted context every remediation operation derives from. */
export interface RemediationContext {
  /** The authenticated user (trusted). */
  userId: string;
  /** The tenant (organization) scope (trusted). */
  tenantId: string;
  /** The verified workspace scope, when present (trusted). */
  workspaceId?: string;
}

/** The caller's resolved agent identity + capability bound (no DTO effects). */
export interface RemediationAgent {
  /** The agent id. */
  id: string;
  /** The effective business role id. */
  roleId: string;
  /** The owning domain id. */
  domainId: string;
  /** The agent's registered capability set (the ONLY allowed capabilities). */
  capabilityIds: readonly string[];
}

/**
 * Resolves the caller's EFFECTIVE agent from trusted membership — the same
 * membership → role → agent seam the S26 agent surface uses. The engine
 * derives plans for this agent only; a client-supplied role/agent is never
 * consulted.
 */
export interface RemediationAgentResolver {
  resolve(context: RemediationContext): Promise<RemediationAgent | undefined>;
}

/** Loads the full investigation DTO of a problem (tenant-scoped). */
export interface RemediationProblemProvider {
  getById(context: RemediationContext, problemId: string): Promise<BusinessProblemDto | undefined>;
  /**
   * Loads MANY problems by id (plan-list reads — one trusted snapshot for
   * all of them, never N+1; S22). Non-existent or foreign ids are omitted.
   */
  listByIds(
    context: RemediationContext,
    problemIds: readonly string[],
  ): Promise<readonly BusinessProblemDto[]>;
}

/**
 * Re-evaluates ONE problem deterministically (S27 re-evaluation seam): the
 * fresh DTO + whether the signal still fires. This is the ONLY honest basis
 * for "problem resolved" and "the plan's solution is still applicable".
 */
export interface RemediationProblemReevaluator {
  reevaluate(
    context: RemediationContext,
    problemId: string,
  ): Promise<{ stillPresent: boolean; problem: BusinessProblemDto } | undefined>;
}

/**
 * Transitions the PROBLEM lifecycle (Phase 10 §10): the plan engine drives
 * REMEDIATION_PLANNED → REMEDIATING → RESOLVED / BLOCKED / FAILED through
 * the SAME deterministic BusinessProblem transition table (implemented by
 * the API layer over the detection problem store). Returns false when the
 * transition is illegal or the problem is gone (the engine fails safe).
 */
export interface RemediationProblemLifecyclePort {
  transition(
    context: RemediationContext,
    problemId: string,
    status: ProblemStatus,
    now: string,
  ): Promise<boolean>;
}

/** The capability metadata the builder/validator need (side-effect + tool). */
export interface RemediationCapabilityMetadata {
  /** The capability id. */
  capabilityId: string;
  /** Display name (step action vocabulary). */
  name: string;
  /** The side-effect class (approval gating policy input). */
  sideEffectClass: 'read_only' | 'state_change' | 'consequential';
  /** The executable tool id implementing the capability, when one exists. */
  toolId?: string;
}

/**
 * Resolves capability metadata from the EXISTING runtime registry (the API
 * layer implements this over the AI Runtime's capability declarations +
 * skill index). A capability with no registered metadata has no executable
 * tool — the validator reports it as unavailable (fail closed).
 */
export interface RemediationCapabilityProvider {
  resolve(capabilityId: string): Promise<RemediationCapabilityMetadata | undefined>;
}

/**
 * The governed execution port: runs ONE capability-bound step through the
 * EXISTING S26 execution path (AgentExecutionPort → AI Runtime →
 * ToolExecutor → ApprovalEngine → verification → decision → journal). There
 * is never a second execution engine.
 */
export interface RemediationExecutionPort {
  execute(
    context: RemediationContext,
    intent: AgentExecutionIntent,
  ): Promise<AgentExecutionOutcome>;
}

/**
 * The durable execution journal (Phase 10 traceability): the API layer
 * implements this over the SAME agent-execution recorder — the remediation
 * record links problem → plan → step → execution in the ONE journal.
 */
export interface RemediationExecutionRecorder {
  record(input: {
    id: string;
    agentId: string;
    roleId: string;
    domainId: string;
    tenantId: string;
    workspaceId?: string;
    userId: string;
    planId: string;
    stepId: string;
    problemId: string;
    proposalId?: string;
    proposalAction?: string;
    status: string;
    runId?: string;
    reason?: string;
    createdAt: string;
  }): Promise<void>;
}

/**
 * The approval engine port (structural subset of the EXISTING AI Runtime
 * `ApprovalEngine`): the engine opens approval requests with a deterministic
 * resume key (dedupe) and reads their decision status. Decisions are made
 * through the EXISTING `/api/ai/approvals/:id/decision` surface — never
 * through this engine.
 */
export interface RemediationApprovalEngine {
  open(input: {
    conversationId: string;
    userId: string;
    tenantId: string;
    workspaceId?: string;
    runId: string;
    stepId: string;
    toolId: string;
    capabilityId: string;
    sideEffectClass: 'read_only' | 'state_change' | 'consequential';
    reason: string;
    intent: string;
    input: Record<string, unknown>;
    resumeKey: string;
  }): Promise<{ id: string }>;
  byResumeKey(
    tenantId: string,
    resumeKey: string,
  ): Promise<{ id: string; status: string } | undefined>;
  decisionStatus(id: string): Promise<'pending' | 'granted' | 'rejected' | undefined>;
}
