/**
 * @nexora/module-workflow — step executor port.
 *
 * The capability-execution seam of the workflow runtime. The engine knows
 * "execute capability X with input Y" — it does NOT know where projects or
 * employees live, which tables back them, or which application service to
 * call. The application composition root wires this port to the platform's
 * tool executor (the AI Runtime's `ToolExecutor`), so workflow steps execute
 * through the exact same governed pipeline as AI tool calls (validate →
 * guard → invoke → verify) — one execution path, no bypass.
 *
 * Identity, tenant, and workspace arrive in the invocation from the
 * workflow's trusted context — never from step input or the LLM.
 */

import type { AutonomyTier, SideEffectClass } from '@nexora/contracts/ai';

/** A step invocation: one capability executed with one tool. */
export interface WorkflowStepInvocation {
  /** The workflow step id. */
  stepId: string;
  /** The capability implementing the step. */
  capabilityId: string;
  /** The tool id invoked for the capability. */
  toolId: string;
  /** The bound step input (user-controlled business values only). */
  input: Record<string, unknown>;
  /** The trusted execution context of the workflow. */
  context: {
    /** The initiating user (trusted). */
    userId: string;
    /** Tenant (organization) scope (trusted). */
    tenantId: string;
    /** Workspace scope, when workspace-scoped (trusted). */
    workspaceId?: string;
    /** Run id for tracing. */
    runId: string;
    /** Autonomy tier of the invoking run. */
    autonomyTier?: AutonomyTier;
  };
  /** Whether approval was granted for this step (gate decisions). */
  approvalGranted: boolean;
}

/** The outcome of a step invocation. */
export interface WorkflowStepResult {
  /** Whether the invocation succeeded and was verified. */
  ok: boolean;
  /** The output on success. */
  output?: unknown;
  /** The failure on error/block. */
  error?: { code: string; message: string };
  /** Whether the invocation was blocked pending approval. */
  blocked: boolean;
  /** Whether the result was verified. */
  verified: boolean;
  /** The side-effect class of the invoked tool. */
  sideEffectClass: SideEffectClass;
  /** Number of attempts. */
  attempts: number;
  /**
   * Whether a failed attempt may be retried safely (the invoked tool is
   * idempotent). Non-idempotent steps are never auto-retried — a retry could
   * duplicate a business mutation.
   */
  retryable?: boolean;
}

/** The step executor port. Implementations never contain workflow logic. */
export interface WorkflowStepExecutor {
  /** Executes one workflow step through the governed capability pipeline. */
  execute(invocation: WorkflowStepInvocation): Promise<WorkflowStepResult>;
}
