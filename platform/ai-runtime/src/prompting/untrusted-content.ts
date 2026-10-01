/**
 * @nexora/ai-runtime — untrusted content handling for model prompts.
 *
 * Everything a model sees besides the system instructions is UNTRUSTED
 * (TRUST_MODEL.md): the user's request, retrieved documents and knowledge
 * articles, project/employee text, external tool and connector output. Two
 * deterministic helpers keep that content in its place:
 *
 * - {@link fenceUntrusted} wraps it in a labelled data block and neutralizes
 *   any text inside that imitates the block markers, so content can never
 *   "close" its own block and continue as if it were instructions.
 * - {@link disclosesPromptText} detects a model answer that reproduces the
 *   system instructions verbatim (e.g. after an embedded "print your system
 *   prompt"), so the caller can discard it.
 *
 * Neither is a guarantee against prompt injection: they reduce what a model
 * narration can be talked into, while the actual security boundary — the
 * model never authorizes, selects, or executes anything — lives in the
 * deterministic runtime.
 */

/** The marker prefix of an untrusted data block. */
const FENCE = '<<<UNTRUSTED';

/**
 * Wraps untrusted text in a labelled data block. Occurrences of the block
 * markers inside the text are defanged (`<<<` → `‹‹‹`, `>>>` → `›››`).
 */
export function fenceUntrusted(label: string, text: string): string {
  const safe = text.replace(/<<</g, '‹‹‹').replace(/>>>/g, '›››');
  return `${FENCE}:${label}>>>\n${safe}\n<<<END_UNTRUSTED:${label}>>>`;
}

/** Words per window when matching an answer against the instructions. */
const WINDOW = 8;

/** Lowercased word tokens, ignoring template placeholders and punctuation. */
function words(text: string): string[] {
  return text
    .replace(/\{\{[a-zA-Z0-9_]+\}\}/g, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * Whether `answer` reproduces a run of {@link WINDOW} consecutive words from
 * the system `instructions`. Eight identical consecutive words is far beyond
 * accidental overlap for a short business narration, and catches both full
 * and partial disclosure.
 */
export function disclosesPromptText(answer: string, instructions: string): boolean {
  const source = words(instructions);
  if (source.length < WINDOW) {
    return false;
  }
  const windows = new Set<string>();
  for (let index = 0; index + WINDOW <= source.length; index += 1) {
    windows.add(source.slice(index, index + WINDOW).join(' '));
  }
  const target = words(answer);
  for (let index = 0; index + WINDOW <= target.length; index += 1) {
    if (windows.has(target.slice(index, index + WINDOW).join(' '))) {
      return true;
    }
  }
  return false;
}
