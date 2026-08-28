/**
 * @nexora/app-web — display humanization layer (S36).
 *
 * A THIN presentation transform, nothing more: turns raw backend
 * identifiers and generated sentences that occasionally reach the UI
 * (dotted.snake_case capability/signal ids, raw knowledge-article
 * reference ids inside an otherwise-human sentence) into business
 * language — WITHOUT touching the backend strings that produce them
 * (`platform/detection`, `platform/remediation`, the capability registry).
 *
 * Every function here is a pure, defensive text transform: input that
 * doesn't match a known raw-identifier shape passes through completely
 * unchanged. That matters twice over — it means a backend copy change can
 * never be silently mangled by an over-eager regex, and it means this file
 * never needs to enumerate every capability/signal id that exists, only
 * the SHAPE they take (`domain.snake_case_action`).
 */

/** A dotted, snake_case backend identifier, e.g. `hr.hire_and_assign_employee`. */
const DOTTED_IDENTIFIER = /\b[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+\b/g;

/**
 * Turns one dotted.snake_case identifier into a Title Case phrase, using
 * only its last segment (the action, not the owning domain) — e.g.
 * `hr.hire_and_assign_employee` → "Hire And Assign Employee". Also accepts
 * a bare snake_case id with no dot (`create_workspace` → "Create Workspace").
 */
export function humanizeIdentifier(id: string): string {
  const segment = id.includes('.') ? (id.split('.').pop() ?? id) : id;
  return segment
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Replaces every standalone dotted.snake_case identifier found in free text. */
export function humanizeIdentifiersInText(text: string): string {
  return text.replace(DOTTED_IDENTIFIER, (match) => humanizeIdentifier(match));
}

/**
 * Humanizes a detected-problem title, e.g.
 * "hr.hire_and_assign_employee requires attention" →
 * "Hire And Assign Employee needs attention".
 */
export function humanizeProblemTitle(title: string): string {
  return humanizeIdentifiersInText(title).replace(/ requires attention$/, ' needs attention');
}

/**
 * Humanizes problem/evidence/root-cause free text that may embed a raw
 * signal identifier (the detection engine's "<id> failed N time(s)
 * (X% unrecoverable error rate)." shape).
 */
export function humanizeProblemText(text: string): string {
  return humanizeIdentifiersInText(text);
}

/**
 * Humanizes a recommendation summary composed as "Known solution found:
 * <source> <raw-reference-id> (\"<label>\"). <rest>" — drops the raw
 * source+id pair, keeps the human label the backend already quoted
 * alongside it. Falls back to generic identifier humanization (and, if
 * nothing matches, the original text) for any other shape.
 */
export function humanizeRecommendationSummary(summary: string): string {
  const match = /^Known solution found: .+ [\w-]+ \("([^"]+)"\)\.\s*(.*)$/.exec(summary);
  if (match !== null) {
    const label = match[1] ?? '';
    const rest = match[2] ?? '';
    return rest.length > 0
      ? `Known solution found: "${label}". ${rest}`
      : `Known solution found: "${label}".`;
  }
  return humanizeIdentifiersInText(summary);
}
