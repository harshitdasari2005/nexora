/**
 * @nexora/ai-runtime — planning strategy.
 *
 * The planning extension point (AIR.md §6): a strategy converts a
 * {@link PlannerContext} into a {@link PlanResult}. Strategies may be
 * deterministic (sequential, rule-based), LLM-backed, or hybrid — the
 * orchestrator is strategy-agnostic.
 */

import type { PlannerContext } from './planner-context.js';
import type { PlanResult } from './plan-result.js';

/** A planning strategy. */
export interface PlanningStrategy {
  /** The strategy name, for observability. */
  readonly name: string;

  /** Produces a plan for the context. */
  plan(context: PlannerContext): Promise<PlanResult> | PlanResult;
}
