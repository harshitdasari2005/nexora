/**
 * @nexora/app-api — governed MCP write adapter (S24 Phase 5 + Phase 6).
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
 * - The approval carries a deterministic `resumeKey` derived from the
 *   TRUSTED identity + tool + validated arguments. S24 Phase 6: with the
 *   durable engine, a re-invocation of the same governed action (even from
 *   a DIFFERENT process after a restart) resolves to the SAME approval via
 *   `byResumeKey` — the pending map is only a fallback for engines without
 *   resume-by-key. The persisted approval is the authority on what executes:
 *   execution always uses the approval's STORED input, never re-sent
 *   arguments.
 * - After a server-side grant, the caller re-invokes the SAME tool with the
 *   SAME arguments; the adapter claims the approval (atomic single-flight)
 *   and executes once. A replayed delivery replays the stored result — it
 *   can never execute twice.
 * - A rejected approval denies execution; approval can never grant a
 *   capability the caller's trusted affinity does not include (the tool was
 *   only reachable if the caller could see it, and the capability check is
 *   re-applied at call time by the server).
 */

import { createHash } from 'node:crypto';
import type { ApprovalEngine, ApprovalRequestRecord } from '@nexora/ai-runtime';
import type { ToolExecutionResult, ToolExecutor } from '@nexora/ai-runtime/execution';
import type { NexoraMCPContext, NexoraMCPToolResult } from '@nexora/mcp';
import { toolError } from '@nexora/mcp';
import { mcpRunKeyField } from './mcp-run-scope.js';

/** How many attempt keys (`<base>`, `<base>:2`, …) a resume lookup walks. */
const MAX_RESUME_ATTEMPTS = 50;

/** A stable serialization of the user-controlled arguments (approval key). */
/** Executor error codes that are policy refusals (surfaced verbatim over MCP). */
const POLICY_ERROR_CODES = new Set([
  'POLICY_DENIED',
  'POLICY_UNAVAILABLE',
  'POLICY_CHANGED_AFTER_APPROVAL',
]);

function stableKey(value: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return JSON.stringify(sorted);
}

/**
 * The deterministic cross-process resume key of a governed action: derived
 * from TRUSTED identity + the canonical tool + the validated arguments —
 * never from a correlation id (which changes across restarts) and never
 * from any client claim.
 */
function resumeKeyFor(
  userId: string,
  workspaceId: string | undefined,
  agentId: string | undefined,
  toolId: string,
  args: Record<string, unknown>,
): string {
  // Prompt 4: the resume key binds the approval to the workspace AND the
  // principal (agent or human) it was opened for — an approval authorized in
  // one workspace, or for one agent, can never be located (and executed)
  // from another.
  return createHash('sha256')
    .update(
      `${userId}\u0000${workspaceId ?? ''}\u0000${agentId ?? ''}\u0000${toolId}\u0000${stableKey(args)}`,
    )
    .digest('hex');
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
  /**
   * Open approvals keyed by (correlationId, toolId, input) — the resume
   * handle FALLBACK for engines without resume-by-key (Phase 5 behavior).
   * With the durable engine the source of truth is the store itself.
   */
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
    const memoryKey = `${context.correlationId}:${this.#toolId}:${stableKey(args)}`;
    const baseResumeKey = resumeKeyFor(
      context.userId,
      context.workspaceId,
      context.agent?.agentId,
      this.#toolId,
      args,
    );

    // Resume resolution: the DURABLE store first (same key across process
    // restarts), then the in-memory fallback for engines without resume-by-key.
    //
    // Attempts (Prompt 9): a TERMINAL approval (rejected / expired / failed)
    // opened by an EARLIER run never blocks a new request — the next attempt
    // uses the key `<base>:<n>` and opens a brand-new approval (a terminal
    // approval is never re-used or resurrected). A terminal approval opened by
    // THIS run is reported to it (the caller learns the outcome) below.
    let resumeKey = baseResumeKey;
    let existing: ApprovalRequestRecord | undefined;
    if (this.#approvals.byResumeKey !== undefined) {
      for (let attempt = 1; attempt <= MAX_RESUME_ATTEMPTS; attempt += 1) {
        resumeKey = attempt === 1 ? baseResumeKey : `${baseResumeKey}:${attempt}`;
        existing = await this.#approvals.byResumeKey(context.tenantId, resumeKey);
        if (existing === undefined) break;
        const settled = await this.#isTerminal(existing);
        if (!settled || existing.runId === context.correlationId) break;
      }
    }
    existing ??= this.#pending.get(memoryKey);

    if (existing !== undefined) {
      const status = await this.#approvals.decisionStatus(existing.id);
      if (status === 'rejected') {
        return toolError(
          'APPROVAL_DENIED',
          'The approval for this action was rejected — nothing was executed',
          { approvalId: existing.id },
        );
      }
      if (status === 'expired') {
        // An expired approval never authorizes anything (granted-but-unclaimed
        // included). The transition/audit event belongs to the sweeper or the
        // decision route — nothing extra is published here.
        return toolError(
          'APPROVAL_EXPIRED',
          'The approval for this action expired — nothing was executed; request it again',
          { approvalId: existing.id },
        );
      }
      if (existing.status === 'failed') {
        // The approved action ran and failed: reported to the run that owns it
        // (a later run requesting the same action gets a fresh approval).
        return toolError(
          'EXECUTION_FAILED',
          'The approved action failed — nothing further was executed',
          { approvalId: existing.id },
        );
      }
      if (status === 'granted') {
        // Defense in depth: the approval must belong to THIS workspace and
        // principal, whatever located it.
        if (
          (existing.workspaceId ?? undefined) !== (context.workspaceId ?? undefined) ||
          (existing.agentId ?? undefined) !== (context.agent?.agentId ?? undefined)
        ) {
          return toolError(
            'APPROVAL_DENIED',
            'This approval belongs to a different workspace or principal — nothing was executed',
            { approvalId: existing.id },
          );
        }
        return this.#execute(existing, context);
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
      const approval = await this.#approvals.open({
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
        // The deterministic cross-process resume handle (durable dedupe).
        resumeKey,
        // The policy's approval governance (POLICY_APPROVAL_AUTHORITY): who may
        // decide, separation of duties and TTL. Tighten-only; absent = legacy.
        ...(first.policy?.approval === undefined
          ? {}
          : {
              separationOfDuties: first.policy.approval.separationOfDuties,
              ...(first.policy.approval.requiredApproverRoleId === undefined
                ? {}
                : { requiredApproverRoleId: first.policy.approval.requiredApproverRoleId }),
              ...(first.policy.approval.ttlMinutes === undefined
                ? {}
                : { ttlMs: first.policy.approval.ttlMinutes * 60_000 }),
            }),
        ...(context.agent === undefined ? {} : { agentId: context.agent.agentId }),
        ...(first.delegationId === undefined ? {} : { delegationId: first.delegationId }),
        // The policy decision the approval is opened under (Prompt 5) — a
        // resumed execution must still be governed by the same rules.
        ...(first.policy === undefined
          ? {}
          : {
              policy: {
                outcome: first.policy.outcome,
                policyId: first.policy.policyId,
                version: first.policy.version,
                reasonCode: first.policy.reasonCode,
                reason: first.policy.reason,
                fingerprint: first.policy.fingerprint,
                rules: first.policy.matchedRules.map(
                  (m) => `${m.policyId}@${m.version}=${m.outcome}`,
                ),
              },
            }),
      });
      this.#pending.set(memoryKey, approval);
      return toolError('APPROVAL_REQUIRED', first.error?.message ?? 'Approval required', {
        approvalId: approval.id,
      });
    }
    if (first.error !== undefined && POLICY_ERROR_CODES.has(first.error.code)) {
      // A policy refusal is reported as itself (not a generic failure).
      return toolError(first.error.code, first.error.message);
    }
    return toolError(
      'EXECUTION_FAILED',
      first.error?.message ?? 'The action could not be executed',
    );
  }

  /**
   * Executes a granted approval exactly once (atomic single-flight claim).
   * The execution input is ALWAYS the approval's STORED input — the
   * persisted approval is the authority on what was approved; re-sent
   * arguments only locate the approval (via the resume key) and can never
   * change what executes.
   */
  async #execute(
    approval: ApprovalRequestRecord,
    context: NexoraMCPContext,
  ): Promise<NexoraMCPToolResult> {
    if (!(await this.#approvals.claim(approval.id))) {
      // Already claimed: a completed approval replays its stored result; a
      // concurrently-executing one is reported as in-flight (never twice).
      const current = await this.#approvals.byId(approval.id);
      if (current?.status === 'completed') {
        return { ok: true, output: this.#toOutput(current.result) };
      }
      if (current?.status === 'expired') {
        return toolError(
          'APPROVAL_EXPIRED',
          'The approval for this action expired — nothing was executed',
          {
            approvalId: approval.id,
          },
        );
      }
      return toolError('EXECUTION_FAILED', 'This approval is already being executed', {
        approvalId: approval.id,
      });
    }
    const result = await this.#executor.execute(
      {
        ...this.#invocation(approval.input, context),
        approvalId: approval.id,
        // The executor refuses to run under a policy other than the one the
        // human approved (POLICY_CHANGED_AFTER_APPROVAL).
        ...(approval.policy === undefined ? {} : { approvedPolicy: approval.policy.fingerprint }),
      },
      true,
    );
    await this.#approvals.recordOutcome(
      approval.id,
      result.ok
        ? { status: 'completed', result: result.output }
        : { status: 'failed', error: result.error?.message },
    );
    if (result.ok) {
      return { ok: true, output: this.#output(result) };
    }
    if (result.error !== undefined && POLICY_ERROR_CODES.has(result.error.code)) {
      return toolError(result.error.code, result.error.message, { approvalId: approval.id });
    }
    return toolError(
      'EXECUTION_FAILED',
      result.error?.message ?? 'The action could not be executed',
      { approvalId: approval.id },
    );
  }

  /** Whether an approval ended without an execution to replay (rejected / expired / failed). */
  async #isTerminal(approval: ApprovalRequestRecord): Promise<boolean> {
    if (approval.status === 'failed') return true;
    const status = await this.#approvals.decisionStatus(approval.id);
    return status === 'rejected' || status === 'expired';
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
      ...mcpRunKeyField(),
      autonomyTier: 'supervised',
      capabilityId: this.#capabilityId,
      origin: 'mcp',
      ...(context.agent === undefined ? {} : { agent: context.agent }),
      // S34: the MCP surface bypasses discovery entirely (direct tool
      // invocation by name) — the executor's own RBAC ceiling check is the
      // ONLY enforcement point for it, so the trusted context's capability
      // set must be threaded through here.
      allowedCapabilityIds: context.capabilityIds,
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
