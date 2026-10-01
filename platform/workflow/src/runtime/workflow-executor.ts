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
    /**
     * The INITIATING run's RBAC capability ceiling (trusted). Applied to every
     * inner step and compensation; an inner capability outside it fails
     * closed. `[]` permits nothing. Absent = no ceiling was bound.
     */
    allowedCapabilityIds?: readonly string[];
    /** Attribution (lineage only, never authority): the agent principal the run executed under. */
    agentId?: string;
    /** Attribution: the delegation that authorized the workflow capability. */
    delegationId?: string;
    /** Attribution: the approval that authorized the workflow (approval engine). */
    approvalId?: string;
  };
  /** Whether approval was granted for this step (gate decisions). */
  approvalGranted: boolean;
  /**
   * Why approval is treated as granted: `approval_engine` (the workflow/step
   * was approved through the approval engine) or `direct_human` (a direct,
   * RBAC-authorized start by a human operator with no approval record — which
   * satisfies only the baseline side-effect gate, never an approval that an
   * organization policy requires).
   */
  approvalBasis?: 'approval_engine' | 'direct_human';
  /**
   * Whether this is a forward step or a compensation (rollback) of an earlier
   * step — recorded in lineage so a partial failure reads as it happened.
   */
  purpose?: 'step' | 'compensation';
  /**
   * For a compensation: the capability of the forward step it undoes. The
   * compensation is bounded by the ceiling through THIS capability.
   */
  compensatesCapabilityId?: string;
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
