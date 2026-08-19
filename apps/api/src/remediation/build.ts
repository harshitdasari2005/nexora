/**
 * @nexora/app-api — governed remediation composition (Phase 10).
 *
 * Wires the GENERIC remediation engine (`@nexora/module-remediation`) with
 * the API-layer implementations — every port reuses an EXISTING seam:
 *
 * - The agent resolver derives the caller's effective agent from the SAME
 *   membership → role → agent seam as the S26 agent surface (the
 *   side-effect-free definition resolver — no DTO side effects).
 * - The problem provider + reevaluator + lifecycle are the SAME S27
 *   detection engine: plans read the full investigation, re-evaluate the
 *   problem after every step, and transition the problem lifecycle through
 *   the same deterministic transition table.
 * - The capability provider resolves capability metadata (side-effect class
 *   + executable tool) from the EXISTING AI Runtime registry — a capability
 *   with no registered tool is unavailable (fail closed).
 * - Approvals go through the EXISTING ApprovalEngine (dedupe by resume key;
 *   decisions via the existing `/api/ai/approvals/:id/decision` surface).
 * - Steps execute through the SAME S26 AgentExecutionPort → AI Runtime →
 *   ToolExecutor → ApprovalEngine → verification → decision → journal
 *   path. The journal is the SAME agent-execution recorder, with the
 *   problem/plan/step linkage added (one journal, full traceability).
 *
 * Pure composition: the engine is unchanged; a future domain registers its
 * own agent + signal + solution and the same engine derives + validates +
 * executes its plans.
 */

import type { EnterpriseAIOrchestrator } from '@nexora/ai-runtime';
import type { RuntimeRegistry, ExecutableToolRegistry, ApprovalEngine } from '@nexora/ai-runtime';
import { createConversation, type ConversationStore } from '@nexora/ai-runtime/conversation';
import type { GetBusinessAgentDefinitionHandler } from '@nexora/module-agents';
import type { AgentExecutionRecorder } from '@nexora/module-agents';
import type { AgentExecutionIntent, AgentExecutionOutcome } from '@nexora/contracts/agent';
import type { ProblemStatus } from '@nexora/contracts/detection';
import {
  DefaultApprovalRoutingPolicy,
  RemediationApplicationService,
  type PlanStore,
  type RemediationAgent,
  type RemediationAgentResolver,
  type RemediationApprovalEngine,
  type RemediationCapabilityProvider,
  type RemediationContext,
  type RemediationExecutionPort,
  type RemediationExecutionRecorder,
  type RemediationProblemLifecyclePort,
  type RemediationProblemProvider,
  type RemediationProblemReevaluator,
} from '@nexora/module-remediation';
import type { BusinessProblemDto } from '@nexora/contracts/detection';

/** Everything the API layer needs to compose the remediation surface. */
export interface BuildRemediationOptions {
  /** The durable plan store (PG in production, in-memory in tests). */
  store: PlanStore;
  /** The side-effect-free agent definition resolver (same seam as S26). */
  getAgentDefinition: GetBusinessAgentDefinitionHandler;
  /** Resolves one problem DTO (S27 detection service). */
  getProblem: (
    context: RemediationContext,
    problemId: string,
  ) => Promise<BusinessProblemDto | undefined>;
  /** Resolves MANY problems in one snapshot (S27 — no N+1). */
  listProblemsByIds: (
    context: RemediationContext,
    problemIds: readonly string[],
  ) => Promise<readonly BusinessProblemDto[]>;
  /** Re-evaluates one problem deterministically (S27 re-evaluation seam). */
  reevaluate: (
    context: RemediationContext,
    problemId: string,
  ) => Promise<{ stillPresent: boolean; problem: BusinessProblemDto } | undefined>;
  /** Transitions the problem lifecycle deterministically (S27 table). */
  transitionProblem: (
    context: RemediationContext,
    problemId: string,
    status: ProblemStatus,
    now: string,
  ) => Promise<boolean>;
  /** The EXISTING AI Runtime capability registry (discovery read-model). */
  registry: RuntimeRegistry;
  /** The EXISTING executable tool registry (tool availability). */
  tools: ExecutableToolRegistry;
  /** The EXISTING ApprovalEngine (the one approval gate). */
  approvals: ApprovalEngine;
  /** The EXISTING S26 governed execution path (one engine). */
  execution: RemediationExecutionPort;
  /** The EXISTING execution journal (one journal, plan-linked records). */
  recorder?: RemediationExecutionRecorder;
}

/** The composed remediation surface. */
export interface RemediationSurface {
  /** Creates a remediation plan for a problem (dynamic, validated). */
  createPlan: RemediationApplicationService['createPlan'];
  /** Advances a plan: execute the next step (one at a time, governed). */
  advance: RemediationApplicationService['advance'];
  /** Re-plans a plan from the CURRENT problem state (bounded). */
  replan: RemediationApplicationService['replan'];
  /** Cancels a plan (human decision). */
  cancel: RemediationApplicationService['cancel'];
  /** Lists the scope's plans (bounded, newest first). */
  list: RemediationApplicationService['list'];
  /** Resolves one plan by id (tenant-scoped; forged ids resolve to nothing). */
  getById: RemediationApplicationService['getById'];
}

/** Builds the remediation surface (generic engine + API implementations). */
export function buildRemediation(options: BuildRemediationOptions): RemediationSurface {
  const agentResolver: RemediationAgentResolver = {
    resolve: async (context) => {
      const result = await options.getAgentDefinition.handle(context);
      if (!result.ok) {
        return undefined;
      }
      return result.agent as RemediationAgent;
    },
  };
  const problemProvider: RemediationProblemProvider = {
    getById: (context, problemId) => options.getProblem(context, problemId),
    listByIds: (context, problemIds) => options.listProblemsByIds(context, problemIds),
  };
  const reevaluator: RemediationProblemReevaluator = {
    reevaluate: (context, problemId) => options.reevaluate(context, problemId),
  };
  const lifecycle: RemediationProblemLifecyclePort = {
    transition: (context, problemId, status, now) =>
      options.transitionProblem(context, problemId, status, now),
  };
  const capabilities: RemediationCapabilityProvider = {
    resolve: async (capabilityId) => {
      const entry = options.registry.resolve('capability', capabilityId);
      if (entry === undefined || entry.registry !== 'capability') {
        return undefined;
      }
      const tool = options.tools.resolve(capabilityId);
      return {
        capabilityId: entry.capability.id,
        name: entry.capability.name,
        sideEffectClass: entry.capability.sideEffectClass,
        ...(tool === undefined ? {} : { toolId: tool.manifest.id }),
      };
    },
  };
  const approvalEngine: RemediationApprovalEngine = {
    open: async (input) => {
      const record = await options.approvals.open(input);
      return { id: record.id };
    },
    byResumeKey: async (tenantId, resumeKey) => {
      const record = await options.approvals.byResumeKey?.(tenantId, resumeKey);
      return record === undefined ? undefined : { id: record.id, status: record.status };
    },
    decisionStatus: async (id) => options.approvals.decisionStatus(id),
  };
  const service = new RemediationApplicationService({
    store: options.store,
    agentResolver,
    problemProvider,
    reevaluator,
    lifecycle,
    capabilities,
    routing: new DefaultApprovalRoutingPolicy(),
    approvals: approvalEngine,
    execution: options.execution,
    recorder: options.recorder,
  });
  return {
    createPlan: (context, request) => service.createPlan(context, request),
    advance: (context, planId) => service.advance(context, planId),
    replan: (context, planId) => service.replan(context, planId),
    cancel: (context, planId) => service.cancel(context, planId),
    list: (context) => service.list(context),
    getById: (context, planId) => service.getById(context, planId),
  };
}

/**
 * The remediation execution port: runs ONE capability-bound step through the
 * EXISTING S26 AgentExecutionPort (the same governed path the agent surface
 * uses). The API layer constructs this from the same orchestrator + trusted
 * business-context builder so there is exactly ONE execution engine.
 */
export interface ApiRemediationExecutionPortDependencies {
  /** The EXISTING Enterprise AI Orchestrator (the one execution engine). */
  orchestrator: EnterpriseAIOrchestrator;
  /**
   * The SAME conversation store the orchestrator resumes from. The
   * orchestrator only resumes a step's `approvalId` when it was opened
   * under a conversation it can find by id (AIR.md §8 R13 — an unknown id
   * is never attached to a fresh conversation, to prevent id-squatting).
   * Remediation's deterministic `remediation:{planId}` id therefore must be
   * created here, once, before the first step of a plan executes — never by
   * widening the orchestrator's general conversation-resolution rule.
   */
  conversations: ConversationStore;
  /** Builds the TRUSTED business context from membership + the catalog. */
  buildBusinessContext: (context: {
    userId: string;
    tenantId: string;
    workspaceId?: string;
  }) => Promise<Parameters<EnterpriseAIOrchestrator['run']>[0]['businessContext']>;
}

/** Implements the remediation execution port over the existing orchestrator. */
export class ApiRemediationExecutionPort implements RemediationExecutionPort {
  readonly #deps: ApiRemediationExecutionPortDependencies;

  constructor(dependencies: ApiRemediationExecutionPortDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    context: RemediationContext,
    intent: AgentExecutionIntent,
  ): Promise<AgentExecutionOutcome> {
    if (intent.conversationId !== undefined) {
      await this.#ensureConversation(intent.conversationId, context);
    }
    const businessContext = await this.#deps.buildBusinessContext({
      userId: context.userId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
    });
    const response = await this.#deps.orchestrator.run({
      utterance: intent.utterance,
      userId: context.userId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      // The capability bound the engine validated — the runtime discovery
      // can never widen it (a step can never self-grant).
      allowedCapabilityIds: intent.allowedCapabilityIds,
      businessContext,
      // The SAME conversation id the engine opened the step's approval
      // under — required for the orchestrator to resolve a resumed
      // `approvalId` (it only matches an approval opened under the SAME
      // conversation; otherwise a granted approval reports blocked).
      conversationId: intent.conversationId,
      // The engine's recorded approval id for the step. The orchestrator
      // validates ownership (user + tenant + tool) and claims it exactly
      // once — a duplicate delivery replays instead of re-running.
      approvalId: intent.approvalId,
    });
    return {
      status: response.status as AgentExecutionOutcome['status'],
      runId: response.runId,
      response: response.response,
      steps: response.steps.map((step) => ({
        stepId: step.stepId,
        capabilityId: step.capabilityId,
        toolId: step.toolId,
        status: step.status,
        output: step.output,
        error: step.error,
        verified: step.verified,
      })),
      approvals: response.approvals.map((approval) => ({
        id: approval.id,
        stepId: approval.stepId,
        toolId: approval.toolId,
        capabilityId: approval.capabilityId,
        status: approval.status,
        sideEffectClass: approval.sideEffectClass,
        input: approval.input,
      })),
      decision: {
        id: response.decision.id,
        outcome: response.decision.outcome,
        madeAt: response.decision.madeAt,
      },
    };
  }

  /**
   * Creates the plan's conversation record the FIRST time a step executes,
   * under its deterministic id — idempotent (a later step, or a retried
   * call, finds it already there and does nothing). This is the one place
   * remediation is allowed to pre-seed a conversation id: it is server-
   * derived from the plan the caller already owns (trusted tenant/workspace
   * scope), never a client-supplied id.
   */
  async #ensureConversation(conversationId: string, context: RemediationContext): Promise<void> {
    const existing = await this.#deps.conversations.load(conversationId);
    if (existing !== undefined) {
      return;
    }
    await this.#deps.conversations.save(
      createConversation({
        id: conversationId,
        tenantId: context.tenantId,
        userId: context.userId,
        workspaceId: context.workspaceId,
      }),
    );
  }
}

/**
 * The remediation execution journal adapter: records remediation executions
 * through the SAME agent-execution recorder (one journal), with the plan
 * linkage columns (`plan_id`, `step_id`, `problem_id`) added for full
 * problem → plan → step → execution traceability (Phase 10 §11).
 */
export class ApiRemediationExecutionRecorder implements RemediationExecutionRecorder {
  readonly #recorder: AgentExecutionRecorder;

  constructor(recorder: AgentExecutionRecorder) {
    this.#recorder = recorder;
  }

  async record(input: {
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
  }): Promise<void> {
    await this.#recorder.record({
      id: input.id,
      agentId: input.agentId,
      roleId: input.roleId,
      domainId: input.domainId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      planId: input.planId,
      stepId: input.stepId,
      problemId: input.problemId,
      proposalId: input.proposalId,
      proposalAction: input.proposalAction,
      status: input.status as AgentExecutionOutcome['status'],
      runId: input.runId,
      reason: input.reason,
      createdAt: input.createdAt,
    });
  }
}
