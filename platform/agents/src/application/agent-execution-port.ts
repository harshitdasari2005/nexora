/**
 * @nexora/module-agents — agent execution ports (S26 Phase 8).
 *
 * The generic engine NEVER executes anything itself: it produces a
 * capability-bound {@link AgentExecutionIntent} (from the trusted context:
 * role → agent → proposal/goal) and hands it to the {@link AgentExecutionPort},
 * implemented by the API layer over the EXISTING Enterprise AI Runtime. The
 * orchestrator's discovery is restricted to `allowedCapabilityIds`, so an
 * intent can never reach a capability outside the agent's registered set —
 * the engine's validation and the runtime's discovery agree (fail closed on
 * both sides). Approval, ToolExecutor, verification, decision records, and
 * audit all continue through the existing runtime; this module only
 * produces intents and journals outcomes.
 *
 * The {@link AgentExecutionRecorder} port persists one journal entry per
 * governed execution (S26 Phase 8 measurements) and reads the recent ones
 * back for the agent DTO — never a second analytics subsystem.
 */

import type {
  AgentExecutionIntent,
  AgentExecutionOutcome,
  AgentExecutionRecord,
} from '@nexora/contracts/agent';
import type { BusinessAgentContext } from './business-agent-application-service.js';

/**
 * Executes a capability-bound agent intent through the EXISTING AI Runtime
 * (orchestrator → discovery → planner → ToolExecutor → approval → verify →
 * decision → audit). Implemented by the API layer; there is never a second
 * execution engine.
 */
export interface AgentExecutionPort {
  /**
   * Runs one governed agent execution.
   *
   * @param context - the trusted context (identity + scopes, server-derived).
   * @param intent  - the capability-bound execution intent.
   */
  execute(
    context: BusinessAgentContext,
    intent: AgentExecutionIntent,
  ): Promise<AgentExecutionOutcome>;
}

/**
 * The persisted journal of governed agent executions (measurements). The
 * implementation is the API layer's durable recorder over the existing
 * persistence seam.
 */
export interface AgentExecutionRecorder {
  /** Records one execution. Must be idempotent by record id. */
  record(record: AgentExecutionRecord): Promise<void>;
  /** Lists the most recent executions for the trusted context, newest first. */
  listRecent(
    context: BusinessAgentContext,
    limit: number,
  ): Promise<readonly AgentExecutionRecord[]>;
  /**
   * Lists the most recent executions across the WHOLE tenant (not just one
   * user), newest first — the read side for cross-user governance views
   * (e.g. an Audit Center). Purely additive to the recorder's read surface;
   * never touches how an execution is decided or run.
   */
  listByTenant(
    tenantId: string,
    options: { workspaceId?: string; limit: number },
  ): Promise<readonly AgentExecutionRecord[]>;
}
