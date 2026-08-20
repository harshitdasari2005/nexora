/**
 * @nexora/ai-runtime — Enterprise AI Orchestrator.
 *
 * The single coordinator of all agents and workflows (AIR.md §2, ADR-001).
 * The EAO owns the conversation, the plan, and the outcome narrative. It
 * performs no domain actions itself — it only executes *discovered tools*
 * through the {@link ToolExecutor}, honoring the pipeline:
 *
 * intent → context → discovery → plan → execute → verify → respond → record.
 *
 * Decision boundaries (AIR.md §2.3): the EAO decides *how work is
 * orchestrated*; the Policy/Approval engines (injected seams) decide *what
 * the domain allows*. In Phase 1 the approval seam is a gate decision; the
 * platform Approval Engine plugs in here without changing the orchestrator.
 */

import type { AutonomyTier, SideEffectClass } from '@nexora/contracts/ai';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import { createLogger, type Logger } from '@nexora/shared/logger';

import {
  buildAIContext,
  type AIBusinessContext,
  type AIContext,
  type ExecutionContext as RunExecutionContext,
  type PermissionContext,
  type UserContext,
} from '../context/index.js';
import { DefaultExecutionVerifier } from '../verification/execution-verifier.js';
import { SequentialPlanner } from '../planner/sequential-planner.js';
import { noopTelemetrySink } from '../telemetry/in-memory-sink.js';
import { RuntimeEventBus } from '../events/runtime-events.js';
import type { ExecutionPlan } from '../planner/plan.js';
import type { ConversationSession } from '../conversation/conversation.js';
import type {
  ApprovalOutcome,
  OrchestratorRequest,
  OrchestratorResponse,
  OrchestratorRunStatus,
  StepOutcome,
} from './request.js';
import type { OrchestratorOptions } from './options.js';
import type { ApprovalEngine, ApprovalRequestRecord } from '../approval/engine.js';
import { RUNTIME_CONFIG_KEYS, runtimeSetting } from './options.js';
import { buildDecisionRecord } from './decision.js';
import { buildExecutionTrace, type TraceBuilder } from './trace.js';
import { composeResponse } from './narration.js';
import { TemplateRenderer } from '../prompting/prompt-renderer.js';
import type { PromptTemplate, PromptVariables } from '../prompting/prompt-template.js';

/**
 * The Enterprise AI Orchestrator. Construct once per runtime with injected
 * dependencies; call {@link run} per interaction.
 */
export class EnterpriseAIOrchestrator {
  readonly #planner;
  readonly #discovery;
  readonly #executor;
  readonly #verifier;
  readonly #conversations;
  readonly #providers?;
  readonly #prompts?;
  readonly #telemetry;
  readonly #events;
  readonly #configManager?;
  readonly #narrationPromptId?;
  readonly #approvals?: ApprovalEngine;
  readonly #logger: Logger;

  constructor(options: OrchestratorOptions) {
    this.#planner = options.planner ?? new SequentialPlanner();
    this.#discovery = options.discovery;
    this.#executor = options.executor;
    this.#verifier = options.verifier ?? new DefaultExecutionVerifier();
    this.#conversations = options.conversations;
    this.#providers = options.providers;
    this.#prompts = options.prompts;
    this.#telemetry = options.telemetry ?? noopTelemetrySink;
    this.#events = options.events ?? new RuntimeEventBus();
    this.#configManager = options.configManager;
    this.#narrationPromptId = options.narrationPromptId;
    this.#approvals = options.approvals;
    this.#logger = createLogger({ service: 'ai-runtime:eao' });
  }

  /** The runtime event bus (for observability hooks). */
  get events(): RuntimeEventBus {
    return this.#events;
  }

  /**
   * Runs one interaction through the orchestration pipeline.
   *
   * @param request - the user request.
   */
  async run(request: OrchestratorRequest): Promise<OrchestratorResponse> {
    const runId = prefixedId('run');
    const startedAt = nowIso();
    const trace = buildExecutionTrace(runId, startedAt);

    const session = await this.#conversations.openSession({
      tenantId: request.tenantId,
      userId: request.userId,
      workspaceId: request.workspaceId,
      conversationId: request.conversationId,
    });
    if (request.approvalId !== undefined) {
      // Resume after a recorded server-side decision: do NOT duplicate the
      // user turn; record the disposition as a system turn (audit trail).
      const disposition =
        ((await this.#approvals?.decisionStatus(request.approvalId)) as
          'pending' | 'granted' | 'rejected' | undefined) ?? 'pending';
      await this.#conversations.addTurn(session, {
        role: 'system',
        content: `Approval ${disposition} recorded for ${request.approvalId}`,
      });
    } else {
      await this.#conversations.addUserTurn(session, request.utterance);
    }

    const autonomyTier = this.#autonomyTier(request);
    const aiContext = this.#assembleContext(
      request,
      runId,
      session.conversationId,
      startedAt,
      autonomyTier,
    );
    trace.stage('context', 'assembled');

    // 1. Capability discovery (permission-filtered, never hardcoded).
    const discovery = this.#discovery.discover({
      intent: request.utterance,
      permissions: aiContext.permissions,
      allowedCapabilityIds: request.allowedCapabilityIds,
      // The trusted business context focuses discovery on the caller's role
      // affinities. It is server-built — a model-claimed role can never
      // change it (discovery ≠ authorization; every tool invocation still
      // passes the existing server-side authorization checks).
      businessContext: aiContext.business,
    });
    trace.stage('discovery', `${discovery.capabilities.length} capability(ies)`);

    if (discovery.capabilities.length === 0) {
      return this.#clarify(request, session, runId, trace, aiContext);
    }

    // 2. Planning.
    const planResult = await this.#planner.plan({
      intent: request.utterance,
      discovery,
      aiContext,
      autonomyTier,
    });
    trace.stage('planning', planResult.success ? `plan ${planResult.plan?.id}` : planResult.reason);

    if (!planResult.success || planResult.plan === undefined) {
      this.#events.publish({
        type: 'plan.executed',
        runId,
        planId: 'none',
        success: false,
        occurredAt: nowIso(),
      });
      return this.#failed(
        request,
        session,
        runId,
        trace,
        aiContext,
        planResult.reason ?? 'Planning failed',
      );
    }

    const plan = planResult.plan;
    this.#events.publish({
      type: 'plan.created',
      runId,
      planId: plan.id,
      intent: plan.intent,
      stepCount: plan.graph.steps.length,
      gateCount: plan.gates.length,
      occurredAt: nowIso(),
    });

    // 3. Execution (only through the ToolExecutor; approvals gate first).
    const { steps, approvals } = await this.#executePlan(plan, request, aiContext, trace, runId);

    // 4. Verification aggregation + narration.
    const allSucceeded = steps.every((step) => step.status === 'succeeded');
    const anyBlocked = steps.some((step) => step.status === 'blocked');
    const anyFailed = steps.some((step) => step.status === 'failed');
    const status: OrchestratorRunStatus = anyBlocked
      ? 'blocked'
      : anyFailed
        ? 'failed'
        : allSucceeded
          ? 'completed'
          : 'failed';

    const response = await this.#narrate(request, plan, steps, approvals, status, aiContext);
    trace.stage('verification', `${status}`);
    trace.complete(status);

    const decision = buildDecisionRecord({
      runId,
      intent: request.utterance,
      plan,
      steps,
      approvals,
      outcome: status === 'blocked' ? 'blocked' : status === 'failed' ? 'failed' : 'completed',
      madeAt: nowIso(),
      // S24 Phase 4: the decision record carries the trusted business
      // context (domain/role/capability affinity) that governed the run.
      business: aiContext.business,
    });

    this.#events.publish({
      type: 'plan.executed',
      runId,
      planId: plan.id,
      success: allSucceeded,
      occurredAt: nowIso(),
    });
    this.#events.publish({
      type: 'response.generated',
      runId,
      conversationId: session.conversationId,
      status,
      occurredAt: nowIso(),
    });

    this.#telemetry.record({ kind: 'trace', trace: trace.toRecord() });
    this.#telemetry.record({ kind: 'decision', decision });
    await this.#conversations.addAssistantTurn(session, response);

    return {
      runId,
      conversationId: session.conversationId,
      status,
      response,
      intent: request.utterance,
      plan,
      steps,
      approvals,
      decision,
      trace: trace.toRecord(),
    };
  }

  async #executePlan(
    plan: ExecutionPlan,
    request: OrchestratorRequest,
    context: AIContext,
    trace: TraceBuilder,
    runId: string,
  ): Promise<{ steps: StepOutcome[]; approvals: ApprovalOutcome[] }> {
    const steps: StepOutcome[] = [];
    const approvals: ApprovalOutcome[] = [];
    const completed = new Set<string>();

    for (const step of plan.graph.steps) {
      const dependenciesMet = step.dependsOn.every((id) => completed.has(id));
      if (!dependenciesMet) {
        steps.push({
          stepId: step.id,
          capabilityId: step.capabilityId,
          toolId: step.toolId,
          status: 'skipped',
          verified: false,
          error: 'Dependencies not satisfied',
        });
        continue;
      }

      const approvalRequired = step.gate?.requiresApproval ?? false;
      // With an approval engine wired, gates are REAL: a request opens a
      // recorded approval and executes ONLY after a granted server-side
      // decision. The caller can never self-grant (no request flag, prompt,
      // or tool argument influences `approvalGranted` here).
      const approval = approvalRequired
        ? await this.#resolveApproval(
            request,
            step,
            context.execution.conversationId,
            runId,
            step.gate?.sideEffectClass ?? 'state_change',
            step.gate?.reason ?? 'Approval required',
          )
        : undefined;
      const approvalGranted =
        approvalRequired && approval !== undefined
          ? ((await this.#approvals?.decisionStatus(approval.id)) ?? undefined) === 'granted'
          : approvalRequired
            ? this.#requestMayAutoApprove(request)
            : true;

      if (approvalRequired) {
        approvals.push({
          stepId: step.id,
          toolId: step.toolId,
          status:
            approval === undefined
              ? approvalGranted
                ? 'granted'
                : 'pending'
              : await this.#disposition(approval),
          sideEffectClass: step.gate?.sideEffectClass ?? 'state_change',
          ...(approval === undefined
            ? {}
            : {
                id: approval.id,
                capabilityId: step.capabilityId,
                input: approval.input,
              }),
        });
      }

      if (approvalRequired && !approvalGranted) {
        steps.push({
          stepId: step.id,
          capabilityId: step.capabilityId,
          toolId: step.toolId,
          status: 'blocked',
          verified: false,
          error: step.gate?.reason ?? 'Approval required',
        });
        continue;
      }

      if (approvalRequired && approval !== undefined && this.#approvals !== undefined) {
        // Single-flight: claim the approved request atomically. A duplicate
        // delivery (same approval id re-run) can never execute the tool
        // again — a completed approval replays its stored result.
        if (!(await this.#approvals.claim(approval.id))) {
          const current = await this.#approvals.byId(approval.id);
          if (current?.status === 'completed') {
            steps.push({
              stepId: step.id,
              capabilityId: step.capabilityId,
              toolId: step.toolId,
              status: 'succeeded',
              output: current.result,
              verified: true,
            });
            completed.add(step.id);
          } else {
            steps.push({
              stepId: step.id,
              capabilityId: step.capabilityId,
              toolId: step.toolId,
              status: 'skipped',
              verified: false,
              error: 'Approval already claimed or executed',
            });
          }
          continue;
        }
      }

      this.#events.publish({
        type: 'tool.invoked',
        runId,
        toolId: step.toolId,
        stepId: step.id,
        occurredAt: nowIso(),
      });
      trace.stage('execution', `tool:${step.toolId}`);

      const result = await this.#executor.execute(
        {
          toolId: step.toolId,
          input: step.input,
          // Trusted identity: derived from the authenticated request, never
          // from the prompt or model-generated arguments (AI security contract).
          userId: context.execution.userId,
          tenantId: context.execution.tenantId,
          workspaceId: context.execution.workspaceId,
          runId,
          autonomyTier: context.permissions.autonomyTier,
          // S34: the SAME capability id + RBAC ceiling discovery already
          // honored — the executor is the final, authoritative enforcement
          // point (a direct MCP tool invocation bypasses discovery
          // entirely, so the ceiling must be re-checked here, not only at
          // discovery time).
          capabilityId: step.capabilityId,
          allowedCapabilityIds: context.permissions.allowedActions,
        },
        approvalGranted,
      );

      if (result.ok) {
        completed.add(step.id);
        steps.push({
          stepId: step.id,
          capabilityId: step.capabilityId,
          toolId: step.toolId,
          status: 'succeeded',
          output: result.output,
          verified: result.verified,
        });
        if (approval !== undefined && this.#approvals !== undefined) {
          await this.#approvals.recordOutcome(approval.id, {
            status: 'completed',
            result: result.output,
          });
        }
        this.#events.publish({
          type: 'tool.succeeded',
          runId,
          toolId: step.toolId,
          stepId: step.id,
          verified: result.verified,
          occurredAt: nowIso(),
        });
      } else {
        steps.push({
          stepId: step.id,
          capabilityId: step.capabilityId,
          toolId: step.toolId,
          status: result.blocked ? 'blocked' : 'failed',
          verified: false,
          error: result.error?.message,
        });
        if (approval !== undefined && this.#approvals !== undefined) {
          await this.#approvals.recordOutcome(approval.id, {
            status: 'failed',
            error: result.error?.message,
          });
        }
        this.#events.publish({
          type: 'tool.failed',
          runId,
          toolId: step.toolId,
          stepId: step.id,
          code: result.error?.code ?? 'EXECUTION_ERROR',
          message: result.error?.message ?? 'Tool failed',
          occurredAt: nowIso(),
        });
        if (!result.blocked) {
          // Fail-fast: a failed step aborts the remaining plan (ER-8).
          break;
        }
      }
    }

    return { steps, approvals };
  }

  async #narrate(
    request: OrchestratorRequest,
    plan: ExecutionPlan,
    steps: readonly StepOutcome[],
    approvals: readonly ApprovalOutcome[],
    status: OrchestratorRunStatus,
    context: AIContext,
  ): Promise<string> {
    const provider = this.#providers?.resolveByCapability('chat');
    if (
      provider === undefined ||
      provider.chat === undefined ||
      this.#narrationPromptId === undefined
    ) {
      return composeResponse({ intent: request.utterance, plan, steps, approvals, status });
    }

    try {
      const prompt = this.#prompts?.resolve(this.#narrationPromptId);
      const system = prompt === undefined ? undefined : renderPrompt(prompt, context, plan);
      const messages = [
        ...(system === undefined ? [] : [{ role: 'system' as const, content: system }]),
        {
          role: 'user' as const,
          content: `Summarize: ${request.utterance}`,
        },
      ];
      const completion = await provider.chat.complete({ messages });
      return completion.content;
    } catch (error) {
      this.#logger.warn('provider narration failed; falling back to deterministic', error);
      return composeResponse({ intent: request.utterance, plan, steps, approvals, status });
    }
  }

  #assembleContext(
    request: OrchestratorRequest,
    runId: string,
    conversationId: string,
    startedAt: string,
    autonomyTier: AutonomyTier,
  ): AIContext {
    const execution: RunExecutionContext = {
      runId,
      tenantId: request.tenantId as TenantId,
      workspaceId: request.workspaceId as WorkspaceId | undefined,
      userId: request.userId,
      conversationId,
      startedAt,
    };
    const user: UserContext = { userId: request.userId };
    const permissions: PermissionContext = {
      userId: request.userId,
      autonomyTier,
      allowedActions: request.allowedCapabilityIds,
    };
    return buildAIContext({
      execution,
      user,
      organization: { tenantId: request.tenantId as TenantId },
      workspace:
        request.workspaceId === undefined
          ? undefined
          : { workspaceId: request.workspaceId as WorkspaceId },
      permissions,
      // Trusted business context flows through untouched: the caller (the
      // API layer) assembled it from membership + the Phase 1 catalog.
      business: request.businessContext,
    });
  }

  /**
   * Resolves the approval governing a gated step. On a resume
   * (`request.approvalId`), returns the recorded request only when it is
   * owned by this run's user + tenant + conversation and guards this exact
   * tool — a foreign or mismatched approval never grants a step. Otherwise
   * opens a new awaiting-approval request.
   */
  async #resolveApproval(
    request: OrchestratorRequest,
    step: { id: string; toolId: string; capabilityId: string; input?: Record<string, unknown> },
    conversationId: string | undefined,
    runId: string,
    sideEffectClass: SideEffectClass,
    reason: string,
  ): Promise<ApprovalRequestRecord | undefined> {
    if (this.#approvals === undefined) {
      return undefined;
    }
    if (request.approvalId !== undefined) {
      const approval = await this.#approvals.byId(request.approvalId);
      if (approval === undefined) {
        return undefined;
      }
      if (
        approval.userId !== request.userId ||
        approval.tenantId !== request.tenantId ||
        approval.toolId !== step.toolId
      ) {
        return undefined;
      }
      if (conversationId !== undefined && approval.conversationId !== conversationId) {
        return undefined;
      }
      return approval;
    }
    if (conversationId === undefined) {
      return undefined;
    }
    return this.#approvals.open({
      conversationId,
      userId: request.userId,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      runId,
      stepId: step.id,
      toolId: step.toolId,
      capabilityId: step.capabilityId,
      sideEffectClass,
      reason,
      intent: request.utterance,
      input: step.input ?? {},
    });
  }

  /** The disposition of a recorded approval for the approval outcome. */
  async #disposition(approval: ApprovalRequestRecord): Promise<'granted' | 'pending' | 'rejected'> {
    const status = await this.#approvals?.decisionStatus(approval.id);
    if (status === 'granted') {
      return 'granted';
    }
    if (status === 'rejected') {
      return 'rejected';
    }
    return 'pending';
  }

  /**
   * Whether the request may auto-approve gated steps. Request-level
   * auto-approve is honored ONLY when the platform enables it via config
   * (`ai.runtime.autoApprove`); the requester can never self-grant approval
   * (BR-13 — approvals come from the approval engine, never the caller).
   */
  #requestMayAutoApprove(request: OrchestratorRequest): boolean {
    if (request.autoApprove !== true) {
      return false;
    }
    const configured = runtimeSetting(this.#configManager, RUNTIME_CONFIG_KEYS.autoApprove, false);
    return configured === true;
  }

  #autonomyTier(_request: OrchestratorRequest): AutonomyTier {
    // SECURITY: the autonomy tier is NEVER derived from client input — the
    // `autonomous` tier skips state-change approval, so a caller must never
    // be able to self-elevate. The tier is derived from platform
    // configuration only (policy-driven); `request.autonomyTier` is ignored
    // here and the supervised default applies when nothing is configured.
    const configured = runtimeSetting(this.#configManager, 'ai.runtime.autonomyTier', undefined);
    return (configured as AutonomyTier | undefined) ?? 'supervised';
  }

  async #clarify(
    request: OrchestratorRequest,
    session: ConversationSession,
    runId: string,
    trace: TraceBuilder,
    context: AIContext,
  ): Promise<OrchestratorResponse> {
    trace.complete('failed');
    const decision = buildDecisionRecord({
      runId,
      intent: request.utterance,
      plan: undefined,
      steps: [],
      approvals: [],
      outcome: 'failed',
      madeAt: nowIso(),
      // S24 Phase 4: even a clarification records the trusted business
      // context that governed the run (auditability).
      business: context.business,
    });
    this.#events.publish({
      type: 'response.generated',
      runId,
      conversationId: session.conversationId,
      status: 'clarification',
      occurredAt: nowIso(),
    });
    const response =
      'I could not find a capability to fulfill that request. Please clarify what you need, or run a search and use manual mode.';
    await this.#conversations.addAssistantTurn(session, response);
    return {
      runId,
      conversationId: session.conversationId,
      status: 'clarification',
      response,
      intent: request.utterance,
      steps: [],
      approvals: [],
      decision,
      trace: trace.toRecord(),
    };
  }

  async #failed(
    request: OrchestratorRequest,
    session: ConversationSession,
    runId: string,
    trace: TraceBuilder,
    context: AIContext,
    reason: string,
  ): Promise<OrchestratorResponse> {
    trace.complete('failed');
    const decision = buildDecisionRecord({
      runId,
      intent: request.utterance,
      plan: undefined,
      steps: [],
      approvals: [],
      outcome: 'failed',
      madeAt: nowIso(),
      // S24 Phase 4: even a failed plan records the trusted business
      // context that governed the run (auditability).
      business: context.business,
    });
    const response = `I could not plan that request: ${reason}`;
    await this.#conversations.addAssistantTurn(session, response);
    return {
      runId,
      conversationId: session.conversationId,
      status: 'failed',
      response,
      intent: request.utterance,
      steps: [],
      approvals: [],
      decision,
      trace: trace.toRecord(),
    };
  }
}

const promptRenderer = new TemplateRenderer();

function renderPrompt(prompt: PromptTemplate, context: AIContext, plan: ExecutionPlan): string {
  const variables: PromptVariables = {};
  for (const name of prompt.variables) {
    if (name === 'intent') {
      variables[name] = plan.intent;
    } else if (name === 'tenantId') {
      variables[name] = context.execution.tenantId;
    } else if (name === 'workspaceId') {
      variables[name] = context.execution.workspaceId ?? '';
    } else if (name === 'businessContext') {
      // Trusted business context (S24 Phase 3): describes WHAT the user's
      // work is about so the model can tailor narration — it grants nothing.
      // The model can never supply these values; they are assembled
      // server-side from trusted membership + the Phase 1 catalog.
      variables[name] = describeBusinessContext(context.business);
    } else {
      variables[name] = '';
    }
  }
  return promptRenderer.render(prompt, variables);
}

/**
 * Serializes the trusted business context into a structured prompt block.
 * Deliberately phrased as context ("the user acts in…"), never as an
 * authority claim ("you are an administrator") — role/capability affinity
 * must not be reinterpretable as a grant.
 */
function describeBusinessContext(business: AIBusinessContext | undefined): string {
  if (business === undefined) {
    return 'None';
  }
  const lines = [
    `Domain: ${business.domainName ?? business.domainId}`,
    `Role: ${business.roleName ?? business.roleId}`,
  ];
  if (business.capabilityIds.length > 0) {
    lines.push(`Relevant capabilities: ${business.capabilityIds.join(', ')}`);
  }
  return lines.join('\n');
}
