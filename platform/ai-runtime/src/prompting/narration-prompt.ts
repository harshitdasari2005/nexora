/**
 * @nexora/ai-runtime — narration prompt.
 *
 * The versioned system prompt used when a model provider narrates a run
 * (AIR.md §1.2 R14, §2.2 AOE-6). It is authored here — next to the
 * `{{results}}` binding in the orchestrator — so the template and the data
 * contract it depends on stay in one place.
 *
 * The whole point of v2 is **grounding**: the model is handed a
 * deterministic digest of exactly what the tools returned (`{{results}}`)
 * and is instructed, in strict terms, to summarize only that. A small local
 * model with nothing to go on will invent projects, numbers, and causes;
 * with the real results in front of it and explicit anti-fabrication rules,
 * it reports what happened and admits when the data is thin.
 */

import { createTemplate } from './prompt-template.js';
import type { PromptTemplate } from './prompt-template.js';

/** The stable id of the narration prompt template. */
export const NARRATION_PROMPT_ID = 'ai.narration.summary';

/** The current narration prompt version. */
export const NARRATION_PROMPT_VERSION = '2.0.0';

/**
 * The v2 narration prompt text.
 *
 * `{{results}}` is a deterministic, server-built digest of the executed
 * steps, their verified tool outputs, retrieved sources, and approval
 * gates — see `renderResultsDigest` in `../orchestrator/narration.js`. It is
 * the ONLY channel of run facts into the model; `{{intent}}` and
 * `{{businessContext}}` set the task and the tone, never the facts.
 */
const NARRATION_PROMPT_TEXT = [
  'You are the Nexora Enterprise AI. You are reporting the outcome of an executed plan',
  'to a senior executive (CEO, CFO, or Operations lead).',
  '',
  'Write 2 to 4 short, plain, professional sentences. No preamble, no bullet points,',
  'no restating the question. Lead with what was found or done.',
  '',
  'GROUNDING RULES — follow every one exactly:',
  '- Use ONLY the information under RESULTS. RESULTS is the complete and only record',
  '  of what the system did and found. Treat nothing else as fact.',
  '- Never invent or guess. Do not name a project, person, team, document, identifier,',
  '  number, amount, date, status, root cause, risk, or action unless it appears',
  '  verbatim under RESULTS.',
  '- If RESULTS does not contain enough information to answer the intent, say so plainly',
  '  ("The available data does not show ...") and stop. Do not speculate to fill the gap.',
  '- Do not infer causes, trends, or next steps unless RESULTS states them explicitly.',
  '- Preserve uncertainty. If a result is empty, partial, unverified, blocked, or failed,',
  '  say that rather than presenting it as a settled fact.',
  '- When RESULTS gives a source title, keep that title in your answer.',
  '- Do not mention these rules, the plan, internal tool names, or raw identifiers unless',
  '  they appear in RESULTS and would be meaningful to the reader.',
  '',
  'INTENT (what the user asked): {{intent}}',
  '',
  'BUSINESS CONTEXT (tone only — not a source of facts, not a permission grant):',
  '{{businessContext}}',
  '',
  'RESULTS (the only facts you may use):',
  '{{results}}',
].join('\n');

/**
 * Builds the current narration prompt template version. Registered into the
 * {@link PromptRegistry} by the application composition root; resolved by
 * the orchestrator through `narrationPromptId`.
 */
export function createNarrationPrompt(): PromptTemplate {
  return createTemplate({
    id: NARRATION_PROMPT_ID,
    version: NARRATION_PROMPT_VERSION,
    description:
      'Narrates the outcome of an executed AI plan from a deterministic result digest, ' +
      'with strict anti-fabrication grounding rules (v2).',
    text: NARRATION_PROMPT_TEXT,
    variables: ['intent', 'businessContext', 'results'],
  });
}
