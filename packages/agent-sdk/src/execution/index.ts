/**
 * @nexora/agent-sdk — execution.
 *
 * The generic execution runtime: executes an {@link ExecutionPlan} (task
 * graph) against an agent's skill and tool registries, respecting step
 * dependencies. The runtime is domain-agnostic — skills do the work.
 */

import type { SkillRegistry } from '../skills/index.js';
import type { ExecutionPlan } from '../planning/index.js';

/** The outcome of executing a single plan step. */
export interface StepExecutionResult {
  /** The step id. */
  stepId: string;
  /** Whether the step succeeded. */
  ok: boolean;
  /** The skill output on success. */
  output?: unknown;
  /** The error message on failure. */
  error?: string;
}

/** The outcome of executing a whole plan. */
export interface PlanExecutionResult {
  /** Whether the whole plan succeeded. */
  ok: boolean;
  /** Per-step outcomes, in execution order. */
  steps: readonly StepExecutionResult[];
  /** ISO-8601 UTC time the plan finished. */
  finishedAt: string;
}

/**
 * Executes a plan's task graph: runs steps whose dependencies are satisfied,
 * in order, feeding each step's input from the plan. Steps with missing
 * skills fail with a clear error. Skills invoke their own tools through the
 * tool registry at runtime — this runtime only coordinates skills.
 */
export async function executePlan(
  plan: ExecutionPlan,
  skills: SkillRegistry,
  context: { tenantId: string; workspaceId?: string; executionId: string },
): Promise<PlanExecutionResult> {
  const results: StepExecutionResult[] = [];
  const completed = new Set<string>();

  for (const step of plan.graph.steps) {
    const dependenciesMet = step.dependsOn.every((dependency) => completed.has(dependency));
    if (!dependenciesMet) {
      results.push({
        stepId: step.id,
        ok: false,
        error: `Dependencies not satisfied: ${step.dependsOn.join(', ')}`,
      });
      continue;
    }

    const skill = skills.resolve(step.skillId);
    if (skill === undefined) {
      results.push({ stepId: step.id, ok: false, error: `Skill not found: ${step.skillId}` });
      continue;
    }

    const output = await skill.execute({
      intent: plan.intent,
      args: step.input,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      executionId: context.executionId,
    });

    if (output.ok) {
      completed.add(step.id);
      results.push({ stepId: step.id, ok: true, output: output.output });
    } else {
      results.push({ stepId: step.id, ok: false, error: output.error });
      break;
    }
  }

  return {
    ok: results.every((result) => result.ok),
    steps: results,
    finishedAt: new Date().toISOString(),
  };
}
