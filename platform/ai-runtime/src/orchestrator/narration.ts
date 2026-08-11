/**
 * @nexora/ai-runtime — narration.
 *
 * The deterministic v1 response composer (AIR.md §2.2 AOE-6 Narration).
 * Composes the outcome narrative from the plan, step outcomes, approvals,
 * and run status. Provider-driven narration is an optional upgrade path —
 * the deterministic composer is always the fallback.
 */

import type { ExecutionPlan } from '../planner/plan.js';
import type { ApprovalOutcome, StepOutcome } from './request.js';

/** Inputs to {@link composeResponse}. */
export interface NarrationInput {
  /** The user intent. */
  intent: string;
  /** The executed plan, when one existed. */
  plan?: ExecutionPlan;
  /** Step outcomes. */
  steps: readonly StepOutcome[];
  /** Approval outcomes. */
  approvals: readonly ApprovalOutcome[];
  /** The run status. */
  status: string;
}

/** Composes the deterministic response narrative. */
export function composeResponse(input: NarrationInput): string {
  const lines: string[] = [];

  if (input.status === 'clarification') {
    return 'I could not determine what you need. Please clarify your request.';
  }
  if (input.status === 'failed') {
    return `I could not complete "${input.intent}". The plan could not be executed.`;
  }

  const succeeded = input.steps.filter((step) => step.status === 'succeeded');
  const blocked = input.steps.filter((step) => step.status === 'blocked');
  const failed = input.steps.filter((step) => step.status === 'failed');

  if (succeeded.length > 0) {
    lines.push(`Completed ${succeeded.length} step(s):`);
    for (const step of succeeded) {
      const verified = step.verified ? ' (verified)' : '';
      lines.push(`- ${step.capabilityId}: done${verified}${renderOutput(step.output)}`);
    }
  }
  if (blocked.length > 0) {
    lines.push(`Awaiting approval for ${blocked.length} step(s):`);
    for (const step of blocked) {
      lines.push(`- ${step.capabilityId}: ${step.error ?? 'approval required'}`);
    }
  }
  if (failed.length > 0) {
    lines.push(`Failed ${failed.length} step(s):`);
    for (const step of failed) {
      lines.push(`- ${step.capabilityId}: ${step.error ?? 'failed'}`);
    }
  }
  if (input.approvals.length > 0) {
    lines.push(`Approvals: ${input.approvals.map((a) => `${a.toolId}=${a.status}`).join(', ')}`);
  }

  if (lines.length === 0) {
    return `Nothing to do for "${input.intent}".`;
  }
  return lines.join('\n');
}

/**
 * Renders a step output as a compact, explainable appendix (AIX-11: the AI
 * must surface what it actually did). The runtime stays generic — output is
 * serialized as-is; only strings are inlined. Serialization is capped so a
 * large tool output cannot bloat the narration.
 */
function renderOutput(output: unknown): string {
  if (output === undefined || output === null) {
    return '';
  }
  if (typeof output === 'string') {
    return ` — ${cap(output)}`;
  }
  return ` — ${cap(JSON.stringify(output))}`;
}

/** Truncates a serialized value for narration (400 chars). */
function cap(value: string): string {
  return value.length > 400 ? `${value.slice(0, 400)}…` : value;
}
