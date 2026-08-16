/**
 * @nexora/app-api — business-agent execution port (S26 Phase 8).
 *
 * The {@link AgentExecutionPort} implementation over the EXISTING Enterprise
 * AI Runtime. A governed agent run is an ordinary orchestrator run whose
 * discovery is RESTRICTED to the intent's `allowedCapabilityIds` (the
 * engine resolved them from the agent's registered capability set) and
 * whose business context is the trusted role/domain/capability affinity
 * resolved from membership — the SAME seam the Command Center and the chat
 * surface use. Everything downstream (planner, ToolExecutor, ApprovalEngine,
 * verification, decision records, telemetry, activity audit) is the existing
 * runtime: there is no second execution engine, no second approval system.
 *
 * The mapping is lossless but display-safe: steps carry their outcome and
 * verified flag, approvals carry only card context (never identity), and
 * the decision record is summarized (id + outcome + time). Approval
 * decisions are made through the EXISTING `/api/ai/approvals/:id/decision`
 * surface — never through this port.
 */

import type { AIBusinessContext, EnterpriseAIOrchestrator } from '@nexora/ai-runtime';
import type { OrchestratorResponse } from '@nexora/ai-runtime/orchestrator';
import type { AgentExecutionIntent, AgentExecutionOutcome } from '@nexora/contracts/agent';
import type { AgentExecutionPort, BusinessAgentContext } from '@nexora/module-agents';

/** Dependencies of the API agent execution port. */
export interface ApiAgentExecutionPortDependencies {
  /** The existing Enterprise AI Orchestrator (the one execution engine). */
  orchestrator: EnterpriseAIOrchestrator;
  /** Builds the TRUSTED business context from membership + the Phase 1 catalog. */
  buildBusinessContext: (context: {
    userId: string;
    tenantId: string;
    workspaceId?: string;
  }) => Promise<AIBusinessContext | undefined>;
}

/** Implements the module execution port over the existing orchestrator. */
export class ApiAgentExecutionPort implements AgentExecutionPort {
  readonly #deps: ApiAgentExecutionPortDependencies;

  constructor(dependencies: ApiAgentExecutionPortDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    context: BusinessAgentContext,
    intent: AgentExecutionIntent,
  ): Promise<AgentExecutionOutcome> {
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
      // can never widen it (an agent can never self-grant).
      allowedCapabilityIds: intent.allowedCapabilityIds,
      businessContext,
    });
    return toAgentExecutionOutcome(response);
  }
}

/** Maps an orchestrator response to the display-safe agent execution outcome. */
export function toAgentExecutionOutcome(response: OrchestratorResponse): AgentExecutionOutcome {
  return {
    status: response.status,
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
