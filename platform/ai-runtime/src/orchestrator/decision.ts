/**
 * @nexora/ai-runtime — decision record builder.
 *
 * Assembles the run's {@link DecisionRecord} at decision time (ADR-011)
 * from the plan, step outcomes, and approval outcomes.
 */

import { prefixedId } from '@nexora/shared/ids';
import type { AIBusinessContext } from '../context/index.js';
import type { DecisionRecord } from '../reasoning/index.js';
import type { ExecutionPlan } from '../planner/plan.js';
import type { ApprovalOutcome, StepOutcome } from './request.js';

/** Inputs to {@link buildDecisionRecord}. */
export interface DecisionInput {
  /** Run id. */
  runId: string;
  /** The user intent. */
  intent: string;
  /** The committed plan, when one existed. */
  plan?: ExecutionPlan;
  /** Step outcomes. */
  steps: readonly StepOutcome[];
  /** Approval outcomes. */
  approvals: readonly ApprovalOutcome[];
  /** The run outcome. */
  outcome: DecisionRecord['outcome'];
  /** ISO-8601 UTC time of the decision. */
  madeAt: string;
  /** The trusted business context (domain/role/capability affinity), when resolved. */
  business?: AIBusinessContext;
}

/** Builds the decision-time record for a run. */
export function buildDecisionRecord(input: DecisionInput): DecisionRecord {
  const succeeded = input.steps.filter((step) => step.status === 'succeeded').length;
  const blocked = input.steps.filter((step) => step.status === 'blocked').length;
  const failed = input.steps.filter((step) => step.status === 'failed').length;
  const reasons: string[] = [];
  if (input.plan !== undefined) {
    reasons.push(`Executed plan ${input.plan.id} with ${input.steps.length} step(s)`);
  }
  if (blocked > 0) {
    reasons.push(`${blocked} step(s) blocked pending human approval`);
  }
  if (failed > 0) {
    reasons.push(`${failed} step(s) failed`);
  }
  return {
    id: prefixedId('dec'),
    runId: input.runId,
    intent: input.intent,
    decision: input.plan?.id ?? 'no-plan',
    alternatives:
      input.plan?.gates.map((gate) => ({
        decision: `Replan around ${gate.stepId}`,
        reasons: [gate.reason],
        rejected: false,
      })) ?? [],
    reasons: reasons.length > 0 ? reasons : ['No capability matched'],
    confidence: { score: succeeded === 0 ? 0 : succeeded / Math.max(1, input.steps.length) },
    outcome: input.outcome,
    madeAt: input.madeAt,
    ...(input.business === undefined ? {} : { businessContext: input.business }),
  };
}
