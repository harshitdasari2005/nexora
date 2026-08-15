/**
 * @nexora/app-api — governed MCP write adapter (S24 Phase 5).
 *
 * The write-tool governance seam of the Nexora MCP server. A write tool is
 * an ADAPTER over the SAME governed execution path the AI Runtime uses:
 *
 *   MCP call → ToolExecutor (existing) → application service → persistence
 *             → verification → ApprovalEngine (open → decide → claim → outcome)
 *
 * There is NO second execution path and NO second approval engine — the
 * adapter holds the existing `ToolExecutor` and `ApprovalEngine` instances
 * and mirrors the orchestrator's gate lifecycle (open on block, single-flight
 * claim on resume, recorded outcome) so MCP-originated writes are governed,
 * audited, and exactly-once.
 *
 * Governance model:
 * - First call: the executor's side-effect guard blocks the consequential
 *   tool (APPROVAL_REQUIRED); the adapter opens a recorded approval and
 *   returns it to the caller.
 * - After a server-side grant, the caller re-invokes the SAME tool with the
 *   SAME trusted correlation id + arguments; the adapter claims the approval
 *   (single-flight) and executes once. A replayed delivery replays the
 *   stored result — it can never execute twice.
 * - A rejected approval denies execution; approval can never grant a
 *   capability the caller's trusted affinity does not include (the tool was
 *   only reachable if the caller could see it, and the capability check is
 *   re-applied at call time by the server).
 */

import type { ApprovalEngine, ApprovalRequestRecord } from '@nexora/ai-runtime';
import type { ToolExecutionResult, ToolExecutor } from '@nexora/ai-runtime/execution';
import type { NexoraMCPContext, NexoraMCPToolResult } from '@nexora/mcp';
import { toolError } from '@nexora/mcp';

/** A stable serialization of the user-controlled arguments (approval key). */
function stableKey(value: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return JSON.stringify(sorted);
}

/** Options of the {@link GovernedWriteAdapter}. */
export interface GovernedWriteAdapterOptions {
  /** The AI runtime's ToolExecutor (the single execution path). */
  executor: ToolExecutor;
  /** The AI runtime's ApprovalEngine (the single governance mechanism). */
  approvals: ApprovalEngine;
  /** The canonical AI tool id to invoke (e.g. `calendar.create_event`). */
  toolId: string;
  /** The capability id the tool requires (e.g. `calendar.create_event`). */
  capabilityId: string;
  /** The human intent recorded on the approval (audit). */
  intent: string;
}

/**
 * Runs a governed write through the existing executor + approval engine.
 */
export class GovernedWriteAdapter {
  readonly #executor: ToolExecutor;
  readonly #approvals: ApprovalEngine;
  readonly #toolId: string;
  readonly #capabilityId: string;
  readonly #intent: string;
  /** Open approvals keyed by (correlationId, toolId, input) — the resume handle. */
  readonly #pending = new Map<string, ApprovalRequestRecord>();

  constructor(options: GovernedWriteAdapterOptions) {
    this.#executor = options.executor;
    this.#approvals = options.approvals;
    this.#toolId = options.toolId;
    this.#capabilityId = options.capabilityId;
    this.#intent = options.intent;
  }

  /**
   * Invokes the governed write under the trusted context. Handles the full
   * approval lifecycle (open → resume → claim → execute → record outcome).
   */
  async invoke(
    args: Record<string, unknown>,
    context: NexoraMCPContext,
  ): Promise<NexoraMCPToolResult> {
    const key = `${context.correlationId}:${this.#toolId}:${stableKey(args)}`;
    const existing = this.#pending.get(key);

    if (existing !== undefined) {
      const status = this.#approvals.decisionStatus(existing.id);
      if (status === 'rejected') {
        return toolError(
          'APPROVAL_DENIED',
          'The approval for this action was rejected — nothing was executed',
          { approvalId: existing.id },
        );
      }
      if (status === 'granted') {
        return this.#execute(existing, args, context);
      }
      return toolError('APPROVAL_REQUIRED', existing.reason, { approvalId: existing.id });
    }

    // First invocation: run through the executor ungated — the side-effect
    // guard blocks the consequential tool and reports APPROVAL_REQUIRED.
    const first = await this.#executor.execute(this.#invocation(args, context), false);
    if (first.ok) {
      return { ok: true, output: this.#output(first) };
    }
    if (first.blocked) {
      const approval = this.#approvals.open({
        conversationId: `mcp:${context.correlationId}`,
        userId: context.userId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        runId: context.correlationId,
        stepId: this.#toolId,
        toolId: this.#toolId,
        capabilityId: this.#capabilityId,
        sideEffectClass: 'consequential',
        reason: first.error?.message ?? 'Approval required',
        intent: this.#intent,
        input: args,
      });
      this.#pending.set(key, approval);
      return toolError('APPROVAL_REQUIRED', first.error?.message ?? 'Approval required', {
        approvalId: approval.id,
      });
    }
    return toolError(
      'EXECUTION_FAILED',
      first.error?.message ?? 'The action could not be executed',
    );
  }

  /** Executes a granted approval exactly once (single-flight claim). */
  async #execute(
    approval: ApprovalRequestRecord,
    args: Record<string, unknown>,
    context: NexoraMCPContext,
  ): Promise<NexoraMCPToolResult> {
    if (!this.#approvals.claim(approval.id)) {
      // Already claimed: a completed approval replays its stored result; a
      // concurrently-executing one is reported as in-flight (never twice).
      const current = this.#approvals.byId(approval.id);
      if (current?.status === 'completed') {
        return { ok: true, output: this.#toOutput(current.result) };
      }
      return toolError('EXECUTION_FAILED', 'This approval is already being executed', {
        approvalId: approval.id,
      });
    }
    const result = await this.#executor.execute(this.#invocation(args, context), true);
    this.#approvals.recordOutcome(
      approval.id,
      result.ok
        ? { status: 'completed', result: result.output }
        : { status: 'failed', error: result.error?.message },
    );
    if (result.ok) {
      return { ok: true, output: this.#output(result) };
    }
    return toolError(
      'EXECUTION_FAILED',
      result.error?.message ?? 'The action could not be executed',
      { approvalId: approval.id },
    );
  }

  #invocation(
    args: Record<string, unknown>,
    context: NexoraMCPContext,
  ): Parameters<ToolExecutor['execute']>[0] {
    return {
      toolId: this.#toolId,
      input: args,
      userId: context.userId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      runId: context.correlationId,
      autonomyTier: 'supervised',
    };
  }

  #output(result: ToolExecutionResult): Record<string, unknown> {
    return this.#toOutput(result.output);
  }

  #toOutput(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return { value };
  }
}
