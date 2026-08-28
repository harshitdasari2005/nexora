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
 * serialized as-is; only strings and the canonical retrieval shape are
 * given a readable form. Serialization is capped so a large tool output
 * cannot bloat the narration.
 */
function renderOutput(output: unknown): string {
  if (output === undefined || output === null) {
    return '';
  }
  if (typeof output === 'string') {
    return ` — ${cap(output)}`;
  }
  const retrieval = renderRetrieval(output);
  if (retrieval !== undefined) {
    return ` — ${retrieval}`;
  }
  return ` — ${cap(JSON.stringify(output))}`;
}

/** One retrieved knowledge reference, as tools emit it. */
interface RetrievedReference {
  title?: unknown;
  snippet?: unknown;
}

/** How many cited sources are named before the rest are summarized. */
const MAX_CITED_SOURCES = 3;

/** Per-snippet character budget in the narration. */
const SNIPPET_BUDGET = 240;

/**
 * Renders the canonical retrieval output (`{ references: [...] }`) as a
 * readable, cited answer instead of a raw JSON dump.
 *
 * This is deterministic grounding, not generation: the text shown is the
 * retrieved snippet verbatim, attributed to its source title, so the answer
 * can always be traced to the document it came from (AIX-11). Nothing is
 * summarized or inferred — retrieval already ran permission-filtered and
 * workspace-scoped, and this only formats what it returned.
 *
 * Returns `undefined` when the output is not a retrieval result, so every
 * other tool keeps the generic JSON rendering.
 */
function renderRetrieval(output: unknown): string | undefined {
  if (typeof output !== 'object' || output === null || !('references' in output)) {
    return undefined;
  }
  const raw = (output as { references: unknown }).references;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  if (raw.length === 0) {
    return 'no matching knowledge found in the documents you can access';
  }

  const cited = raw.slice(0, MAX_CITED_SOURCES).map((reference) => {
    const { title, snippet } = reference as RetrievedReference;
    const label = typeof title === 'string' && title.length > 0 ? title : 'Untitled source';
    const body = typeof snippet === 'string' ? snippet.trim() : '';
    return body.length === 0 ? `“${label}”` : `“${label}”: ${truncate(body, SNIPPET_BUDGET)}`;
  });

  const remaining = raw.length - cited.length;
  const more = remaining > 0 ? ` (+${remaining} more source${remaining === 1 ? '' : 's'})` : '';
  return `${cited.join(' · ')}${more}`;
}

/** Truncates a serialized value for narration (400 chars). */
function cap(value: string): string {
  return truncate(value, 400);
}

/** Truncates to a character budget, marking the cut with an ellipsis. */
function truncate(value: string, budget: number): string {
  return value.length > budget ? `${value.slice(0, budget)}…` : value;
}
