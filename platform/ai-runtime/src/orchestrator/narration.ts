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
  const described = describeOutput(output);
  return described.length === 0 ? '' : ` — ${described}`;
}

/**
 * The readable form of a single tool output, with no leading separator.
 * Strings pass through (capped); the canonical retrieval shape
 * (`{ references: [...] }`) becomes a cited line; anything else is capped
 * JSON. Shared by the user-facing composer and the model-facing digest so
 * both describe a result identically.
 */
function describeOutput(output: unknown): string {
  if (output === undefined || output === null) {
    return '';
  }
  if (typeof output === 'string') {
    return cap(output);
  }
  const retrieval = renderRetrieval(output);
  if (retrieval !== undefined) {
    return retrieval;
  }
  return cap(JSON.stringify(output));
}

/** Inputs to {@link renderResultsDigest}. */
export interface ResultsDigestInput {
  /** Per-step outcomes, in execution order. */
  steps: readonly StepOutcome[];
  /** Approval gate outcomes. */
  approvals: readonly ApprovalOutcome[];
  /** The run status. */
  status: string;
}

/** Per-output character budget inside the digest (larger than a snippet). */
const DIGEST_OUTPUT_BUDGET = 1200;

/**
 * Renders a **deterministic, faithful digest of what the run actually
 * produced** — the grounding payload handed to a model provider for
 * narration (see `prompting/narration-prompt.js`).
 *
 * This is not prose and not a summary: it is a structured transcript of the
 * executed steps, their verified tool outputs (retrieval results shown with
 * their source titles), and the approval gates, plus the run status. The
 * model is instructed to summarize ONLY this text, so the digest must
 * contain every fact the answer may state and must not editorialize.
 *
 * Faithfulness rules:
 * - No step output is fabricated or inferred; an empty output is reported
 *   as empty, not omitted.
 * - Raw failure messages are NOT included (they can carry internal detail —
 *   the same reason the user-facing failure narrative stays generic). A
 *   failed step is reported as "did not complete", which the prompt turns
 *   into an honest "could not be determined".
 * - A trailing NOTE is added when nothing substantive came back, so a
 *   model with thin input is pushed toward "the data does not show ..."
 *   rather than invention.
 */
export function renderResultsDigest(input: ResultsDigestInput): string {
  const lines: string[] = [`Run status: ${input.status}`, ''];

  if (input.steps.length === 0) {
    lines.push('No tools were executed, so there are no results.');
  }

  let substantive = 0;
  input.steps.forEach((step, index) => {
    const n = index + 1;
    if (step.status === 'succeeded') {
      const verified = step.verified ? 'verified' : 'unverified';
      const described = describeOutputForDigest(step.output);
      if (described.length > 0) {
        substantive += 1;
        lines.push(`${n}. ${step.capabilityId} — succeeded (${verified})`);
        for (const outputLine of described.split('\n')) {
          lines.push(`   ${outputLine}`);
        }
      } else {
        lines.push(`${n}. ${step.capabilityId} — succeeded (${verified}), but returned no data`);
      }
    } else if (step.status === 'blocked') {
      lines.push(`${n}. ${step.capabilityId} — blocked, awaiting human approval; not executed`);
    } else if (step.status === 'failed') {
      lines.push(`${n}. ${step.capabilityId} — did not complete; no result was returned`);
    } else {
      lines.push(`${n}. ${step.capabilityId} — skipped; an earlier step did not complete`);
    }
  });

  if (input.approvals.length > 0) {
    lines.push('', 'Approval gates:');
    for (const approval of input.approvals) {
      const label = approval.capabilityId ?? approval.toolId;
      lines.push(`- ${label} — ${approval.status} (${approval.sideEffectClass})`);
    }
  }

  if (substantive === 0) {
    lines.push(
      '',
      'NOTE: No substantive data was returned by any step. If the intent cannot be ' +
        'answered from the above, say so explicitly and do not speculate.',
    );
  }

  return lines.join('\n');
}

/**
 * {@link describeOutput} for the model-facing digest. Retrieval results are
 * expanded — one line per source, each carrying the full snippet the tool
 * returned — so the model can be told to consider every reference, not just
 * the first. Any upstream snippet truncation is preserved as-is; the digest
 * itself does not shorten a snippet further.
 */
function describeOutputForDigest(output: unknown): string {
  if (typeof output === 'string') {
    return truncate(output, DIGEST_OUTPUT_BUDGET);
  }
  const retrieval = renderRetrieval(output, {
    maxSources: DIGEST_MAX_SOURCES,
    snippetBudget: DIGEST_SNIPPET_BUDGET,
    layout: 'lines',
  });
  if (retrieval !== undefined) {
    return retrieval;
  }
  if (output === undefined || output === null) {
    return '';
  }
  return truncate(JSON.stringify(output), DIGEST_OUTPUT_BUDGET);
}

/** One retrieved knowledge reference, as tools emit it. */
interface RetrievedReference {
  title?: unknown;
  snippet?: unknown;
}

/** How many cited sources the user-facing composer names inline. */
const MAX_CITED_SOURCES = 3;

/** Per-snippet character budget in the user-facing composer. */
const SNIPPET_BUDGET = 240;

/** How many sources the model-facing digest enumerates (grounding coverage). */
const DIGEST_MAX_SOURCES = 8;

/**
 * Per-snippet budget in the digest. Higher than the composer's so the digest
 * never becomes the truncation bottleneck — only an upstream limit (the
 * knowledge layer's snippet bound) can shorten what the model sees.
 */
const DIGEST_SNIPPET_BUDGET = 600;

/** Rendering options for {@link renderRetrieval}. */
interface RetrievalRenderOptions {
  /** Maximum sources rendered before the rest are counted. */
  maxSources: number;
  /** Per-snippet character budget. */
  snippetBudget: number;
  /**
   * `inline` joins sources with ` · ` (compact, user-facing); `lines` puts
   * each source on its own `- Source N —` line (the digest — one anchor per
   * reference for "consider every source").
   */
  layout: 'inline' | 'lines';
}

/** The composer's inline defaults. */
const INLINE_RETRIEVAL_OPTIONS: RetrievalRenderOptions = {
  maxSources: MAX_CITED_SOURCES,
  snippetBudget: SNIPPET_BUDGET,
  layout: 'inline',
};

/**
 * Renders the canonical retrieval output (`{ references: [...] }`) as a
 * readable, cited answer instead of a raw JSON dump.
 *
 * This is deterministic grounding, not generation: the text shown is the
 * retrieved snippet verbatim, attributed to its source title, so the answer
 * can always be traced to the document it came from (AIX-11). Nothing is
 * summarized, reordered, or inferred — retrieval already ran
 * permission-filtered and workspace-scoped, and this only formats what it
 * returned. Every reference is rendered (up to `maxSources`); none is
 * dropped for relevance here.
 *
 * Returns `undefined` when the output is not a retrieval result, so every
 * other tool keeps the generic JSON rendering.
 */
function renderRetrieval(
  output: unknown,
  options: RetrievalRenderOptions = INLINE_RETRIEVAL_OPTIONS,
): string | undefined {
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

  const shown = raw.slice(0, options.maxSources).map((reference, index) => {
    const { title, snippet } = reference as RetrievedReference;
    const label = typeof title === 'string' && title.length > 0 ? title : 'Untitled source';
    const body = typeof snippet === 'string' ? snippet.trim() : '';
    const rendered =
      body.length === 0 ? `“${label}”` : `“${label}”: ${truncate(body, options.snippetBudget)}`;
    return options.layout === 'lines' ? `- Source ${index + 1} — ${rendered}` : rendered;
  });

  const remaining = raw.length - shown.length;
  const more =
    remaining > 0 ? `+${remaining} more source${remaining === 1 ? '' : 's'} not shown` : '';

  if (options.layout === 'lines') {
    return [...shown, ...(more.length > 0 ? [`- ${more}`] : [])].join('\n');
  }
  return `${shown.join(' · ')}${more.length > 0 ? ` (${more})` : ''}`;
}

/** Truncates a serialized value for narration (400 chars). */
function cap(value: string): string {
  return truncate(value, 400);
}

/** Truncates to a character budget, marking the cut with an ellipsis. */
function truncate(value: string, budget: number): string {
  return value.length > budget ? `${value.slice(0, budget)}…` : value;
}
