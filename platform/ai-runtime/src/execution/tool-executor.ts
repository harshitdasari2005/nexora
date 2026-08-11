/**
 * @nexora/ai-runtime — tool executor.
 *
 * The execution gatekeeper for everything the runtime does (AIR.md §10): it
 * resolves, validates, guards, invokes, retries, times out, and verifies
 * tool calls. No tool executes outside this executor (ADR-001). The
 * orchestrator dispatches only through here — the runtime never calls
 * business services directly.
 */

import { toNexoraError } from '@nexora/shared/errors';
import type { AutonomyTier } from '@nexora/contracts/ai';

import type { ExecutableToolRegistry } from '../registry/executable-tools.js';
import type { ExecutionVerifier } from '../verification/execution-verifier.js';
import { DefaultExecutionVerifier } from '../verification/execution-verifier.js';
import { evaluateSideEffect } from './side-effect-guard.js';
import { noRetryPolicy, sleep, type RetryPolicy } from './retry-policy.js';
import { noTimeoutPolicy, type TimeoutPolicy } from './timeout-policy.js';

/** A single tool invocation request. */
export interface ToolInvocation {
  /** The tool id to invoke. */
  toolId: string;
  /** The input payload (untrusted — model-generated arguments). */
  input: Record<string, unknown>;
  /** The authenticated user id (trusted server-side context). */
  userId: string;
  /** Tenant scope (trusted). */
  tenantId: string;
  /** Workspace scope, when workspace-scoped (trusted). */
  workspaceId?: string;
  /** Run id for tracing. */
  runId: string;
  /** Autonomy tier of the invoking run (approval gating). */
  autonomyTier?: AutonomyTier;
}

/** The outcome of a tool invocation. */
export interface ToolExecutionResult {
  /** Whether the invocation succeeded and was verified. */
  ok: boolean;
  /** The tool id invoked. */
  toolId: string;
  /** The output on success. */
  output?: unknown;
  /** The failure on error/block. */
  error?: { code: string; message: string };
  /** Number of attempts (1 when the first attempt succeeded). */
  attempts: number;
  /** Whether the result was verified (AI-6). */
  verified: boolean;
  /** Whether the invocation was blocked pending approval. */
  blocked: boolean;
  /** ISO-8601 UTC completion time. */
  completedAt: string;
}

/** Options for the {@link ToolExecutor}. */
export interface ToolExecutorOptions {
  /** The registry of executable tools. */
  tools: ExecutableToolRegistry;
  /** The verifier; defaults to a {@link DefaultExecutionVerifier}. */
  verifier?: ExecutionVerifier;
  /** The retry policy; defaults to no-retry (non-idempotent tools never auto-retry). */
  retryPolicy?: RetryPolicy;
  /** The timeout policy; defaults to no timeout. */
  timeoutPolicy?: TimeoutPolicy;
}

/** Executes tools through the governed pipeline (validate → guard → invoke → verify). */
export class ToolExecutor {
  readonly #tools: ExecutableToolRegistry;
  readonly #verifier: ExecutionVerifier;
  readonly #retryPolicy: RetryPolicy;
  readonly #timeoutPolicy: TimeoutPolicy;

  constructor(options: ToolExecutorOptions) {
    this.#tools = options.tools;
    this.#verifier = options.verifier ?? new DefaultExecutionVerifier();
    this.#retryPolicy = options.retryPolicy ?? noRetryPolicy;
    this.#timeoutPolicy = options.timeoutPolicy ?? noTimeoutPolicy;
  }

  /**
   * Invokes a tool under the governed pipeline.
   *
   * @param invocation - the invocation request.
   * @param approvalGranted - whether human approval has been granted (for
   *        gated actions; BR-13).
   */
  async execute(invocation: ToolInvocation, approvalGranted = false): Promise<ToolExecutionResult> {
    const tool = this.#tools.resolve(invocation.toolId);
    if (tool === undefined) {
      return this.#failure(invocation, {
        code: 'NOT_FOUND',
        message: `Tool not found: ${invocation.toolId}`,
      });
    }

    const tier = invocation.autonomyTier ?? 'supervised';
    const guard = evaluateSideEffect(tool.manifest.sideEffectClass, tier);
    if (guard.requiresApproval && !approvalGranted) {
      return {
        ok: false,
        toolId: invocation.toolId,
        error: {
          code: 'APPROVAL_REQUIRED',
          message: guard.reason,
        },
        attempts: 0,
        verified: false,
        blocked: true,
        completedAt: new Date().toISOString(),
      };
    }

    const maxAttempts = tool.manifest.idempotent ? this.#retryPolicy.maxAttempts : 1;
    let lastError: { code: string; message: string } | undefined;
    let attempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      try {
        const raw = await this.#timeoutPolicy.run(() =>
          tool.execute(invocation.input, {
            userId: invocation.userId,
            tenantId: invocation.tenantId,
            workspaceId: invocation.workspaceId,
            executionId: invocation.runId,
          }),
        );
        const verification = await this.#verifier.verify({
          ok: raw.ok,
          output: raw.output,
          error: raw.ok
            ? undefined
            : { code: 'EXECUTION_ERROR', message: raw.error ?? 'Tool failed' },
        });
        if (raw.ok && verification.verified) {
          return {
            ok: true,
            toolId: invocation.toolId,
            output: raw.output,
            attempts,
            verified: true,
            blocked: false,
            completedAt: new Date().toISOString(),
          };
        }
        if (raw.ok) {
          // Unverified result: reported unverified, never done (TLR-3).
          return {
            ok: false,
            toolId: invocation.toolId,
            error: { code: 'UNVERIFIED', message: verification.message },
            attempts,
            verified: false,
            blocked: false,
            completedAt: new Date().toISOString(),
          };
        }
        lastError = { code: 'EXECUTION_ERROR', message: raw.error ?? 'Tool failed' };
        break;
      } catch (caught) {
        const error = toNexoraError(caught);
        lastError = { code: error.code, message: error.message };
        if (!tool.manifest.idempotent || !this.#retryPolicy.isRetryable(lastError)) {
          break;
        }
        if (attempt < maxAttempts) {
          await sleep(this.#retryPolicy.delayForAttempt(attempt));
        }
      }
    }

    return this.#failure(
      invocation,
      lastError ?? { code: 'EXECUTION_ERROR', message: 'Tool failed' },
      attempts,
    );
  }

  #failure(
    invocation: ToolInvocation,
    error: { code: string; message: string },
    attempts = 0,
  ): ToolExecutionResult {
    return {
      ok: false,
      toolId: invocation.toolId,
      error,
      attempts,
      verified: false,
      blocked: false,
      completedAt: new Date().toISOString(),
    };
  }
}
