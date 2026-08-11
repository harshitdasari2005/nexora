/**
 * @nexora/agent-sdk — planning.
 *
 * Planning abstractions (AIR.md §6): an execution plan is a task graph of
 * steps the agent executes toward a user intent. The `PlanningStrategy` is
 * the extension point — agents plug in their own planner (rule-based, LLM,
 * or hybrid) without changing the SDK.
 */

import type { SkillId } from '../types/index.js';

/** Execution state of a single plan step. */
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

/**
 * A single step in an execution plan.
 */
export interface ExecutionStep {
  /** Step id, unique within the plan. */
  id: string;
  /** The skill id that implements this step. */
  skillId: SkillId | string;
  /** Step input, passed to the skill. */
  input: Record<string, unknown>;
  /** Step ids that must complete before this step runs. */
  dependsOn: readonly string[];
  /** Current execution status. */
  status: StepStatus;
  /** Optional step output after execution. */
  output?: unknown;
  /** Optional error message when the step failed. */
  error?: string;
}

/**
 * A task graph: an ordered list of steps plus entry points. The planner
 * produces the graph; the runtime executes it respecting dependencies.
 */
export interface TaskGraph {
  /** All steps of the plan. */
  steps: readonly ExecutionStep[];
  /** Step ids that may start immediately (no pending dependencies). */
  entryPointIds: readonly string[];
}

/**
 * An execution plan produced by a {@link PlanningStrategy}.
 */
export interface ExecutionPlan {
  /** The task graph to execute. */
  graph: TaskGraph;
  /** The user intent the plan satisfies. */
  intent: string;
  /** ISO-8601 UTC time the plan was created. */
  createdAt: string;
}

/**
 * The result of planning: the plan plus reasoning/confidence.
 */
export interface PlanResult {
  /** The plan to execute. */
  plan: ExecutionPlan;
  /** The strategy that produced the plan. */
  strategy: string;
  /** Whether planning succeeded. */
  success: boolean;
  /** Optional reason when planning failed. */
  reason?: string;
  /** Confidence in the plan, 0..1 when available. */
  confidence?: number;
}

/**
 * The planning strategy contract. Agents implement this to convert a user
 * intent into an execution plan; the SDK is provider-independent, so the
 * strategy may be rule-based, LLM-backed, or hybrid.
 */
export interface PlanningStrategy {
  /** The strategy name, for observability. */
  readonly name: string;

  /**
   * Converts a user intent into an execution plan.
   *
   * @param intent      - the user intent.
   * @param context     - the execution scope.
   * @param constraints - optional constraints (e.g. allowed skills).
   * @returns a {@link PlanResult}; `success: false` carries a reason.
   */
  plan(
    intent: string,
    context: { tenantId: string; workspaceId?: string; executionId: string },
    constraints?: readonly string[],
  ): PlanResult;
}

/**
 * Constructs a plan from a task graph.
 */
export function createPlan(graph: TaskGraph, intent: string, createdAt: string): ExecutionPlan {
  return { graph, intent, createdAt };
}

/**
 * A simple sequential-plan strategy: converts an ordered list of
 * (skillId, input) pairs into a plan whose steps run one after another.
 * Useful for deterministic agents and tests.
 */
export class SequentialPlanningStrategy implements PlanningStrategy {
  readonly name = 'sequential';

  /**
   * @param steps - the ordered (skillId, input) pairs to execute.
   */
  constructor(
    private readonly steps: readonly { skillId: string; input: Record<string, unknown> }[],
  ) {}

  plan(
    intent: string,
    _context: { tenantId: string; workspaceId?: string; executionId: string },
    _constraints?: readonly string[],
  ): PlanResult {
    const steps = this.steps.map((step, index) => ({
      id: `step_${index + 1}`,
      skillId: step.skillId,
      input: step.input,
      dependsOn: index === 0 ? [] : [`step_${index}`],
      status: 'pending' as const,
    }));
    return {
      plan: createPlan({ steps, entryPointIds: ['step_1'] }, intent, new Date().toISOString()),
      strategy: this.name,
      success: true,
      confidence: 1,
    };
  }
}
