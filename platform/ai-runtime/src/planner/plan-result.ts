/**
 * @nexora/ai-runtime — plan result.
 *
 * The outcome of planning: a committed plan plus the strategy, confidence,
 * and reasoning that produced it (AIR.md §6.1). `success: false` carries a
 * reason and, per PLN-7, the orchestrator offers clarification/search/manual
 * mode rather than guessing.
 */

import type { ExecutionPlan } from './plan.js';

/** The result of a planning attempt. */
export interface PlanResult {
  /** Whether planning succeeded. */
  success: boolean;
  /** The plan to execute, when successful. */
  plan?: ExecutionPlan;
  /** The planning strategy that produced the plan. */
  strategy: string;
  /** Reason when planning failed (PLN-7 clarification path). */
  reason?: string;
  /** Confidence in the plan, 0..1 when available. */
  confidence?: number;
}
