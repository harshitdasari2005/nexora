/**
 * @nexora/ai-runtime — plan artifact.
 *
 * The plan (AIR.md §6.2) is the artifact everything downstream honors: a
 * task graph of typed steps over registered capabilities, dependency-ordered,
 * with gates (approval checkpoints), the authority envelope it was validated
 * under, and its explanation. Plans are immutable once committed; replanning
 * produces a new plan version.
 */

import type { SideEffectClass } from '@nexora/contracts/ai';
import type { Timestamp } from '@nexora/contracts/common';

/** Execution state of a plan step. */
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';

/** An approval checkpoint on a step (AIR.md §6.2 gates). */
export interface PlanGate {
  /** The step id the gate guards. */
  stepId: string;
  /** Side-effect class that triggered the gate. */
  sideEffectClass: SideEffectClass;
  /** Whether the gate requires human approval. */
  requiresApproval: boolean;
  /** Why the gate exists (explainability). */
  reason: string;
}

/** A single plan step: one capability executed with one tool. */
export interface ExecutionStep {
  /** Step id, unique within the plan. */
  id: string;
  /** The capability id implementing this step. */
  capabilityId: string;
  /** The skill id backing the capability. */
  skillId: string;
  /** The tool id invoked for this step. */
  toolId: string;
  /** Step input, passed to the tool. */
  input: Record<string, unknown>;
  /** Step ids that must complete before this step runs. */
  dependsOn: readonly string[];
  /** The approval gate on this step, when one applies. */
  gate?: PlanGate;
  /**
   * Workflow display steps: when this step orchestrates a workflow, the
   * deterministic plan steps the workflow will execute (safe display data
   * only — names and capabilities, never identity or chain-of-thought).
   */
  workflowSteps?: readonly { id: string; name: string; capabilityId: string }[];
  /** Current execution status. */
  status: StepStatus;
  /** Step output after execution. */
  output?: unknown;
  /** Error message when the step failed or was blocked. */
  error?: string;
}

/** A task graph: dependency-ordered steps plus entry points (AIR.md §6.4). */
export interface TaskGraph {
  /** All steps of the plan. */
  steps: readonly ExecutionStep[];
  /** Step ids that may start immediately (no pending dependencies). */
  entryPointIds: readonly string[];
}

/** A committed execution plan (AIR.md §6.2). */
export interface ExecutionPlan {
  /** Plan id (`plan_...`). */
  id: string;
  /** The user intent the plan satisfies. */
  intent: string;
  /** The task graph. */
  graph: TaskGraph;
  /** All gates across the plan's steps. */
  gates: readonly PlanGate[];
  /** The authority envelope the plan was validated under. */
  authorityEnvelope: string;
  /** ISO-8601 UTC time the plan was created. */
  createdAt: Timestamp;
}
