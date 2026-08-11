/**
 * @nexora/app-api — knowledge-question fallback matcher.
 *
 * The enterprise knowledge experience: a user asks a QUESTION about their
 * workspace ("What is the deadline for the Mobile Banking project?"). The
 * deterministic token matcher requires noun evidence in the intent, but a
 * knowledge question frequently contains no document/knowledge vocabulary —
 * so the question would otherwise land in "clarification".
 *
 * This matcher wraps the base {@link CapabilityMatcher} with a narrow,
 * deterministic fallback (the same pattern as the workflow planner):
 * when NO other capability matched AND the intent is a question, the
 * `knowledge.search` capability is returned as the sole candidate. It is
 * read-only, permission-filtered, and workspace-scoped — a question can
 * only ever retrieve what the caller is authorized to see.
 *
 * The fallback is deliberately narrow:
 * - It never fires when any other capability matched (no hijacking of
 *   "What workspaces do I have?").
 * - It never fires for non-question intents ("Sing me a song" still
 *   clarifies; an imperative write is never guessed into a knowledge
 *   search).
 * - The capability must actually be registered and permission-filtered
 *   into the candidate set — the model cannot enable it.
 */

import { CapabilityMatcher, type CapabilityScore } from '@nexora/ai-runtime';
import type { CapabilityDeclaration } from '@nexora/contracts/ai';

/** Options for {@link KnowledgeFallbackMatcher}. */
export interface KnowledgeFallbackMatcherOptions {
  /** The capability id of the knowledge search (default `knowledge.search`). */
  knowledgeCapabilityId?: string;
  /** Minimum question length for the fallback to fire. */
  minQuestionLength?: number;
}

/** Question-initial words that mark an intent as a question. */
const QUESTION_WORDS: readonly string[] = [
  'what',
  'when',
  'where',
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'which',
  'does',
  'do',
  'did',
  'is',
  'are',
  'was',
  'were',
  'can',
  'could',
  'would',
  'should',
  'will',
  'may',
  'might',
  'tell',
  'show',
  'find',
  'explain',
  'summarize',
  'summarise',
  'search',
];

/**
 * Determines whether an intent is a question (ends with `?` or starts with
 * a question word). Imperatives ("Sing me a song") and plain statements are
 * not questions — they keep the existing clarification path.
 */
export function isKnowledgeQuestion(intent: string, minLength = 8): boolean {
  const trimmed = intent.trim();
  if (trimmed.length < minLength) {
    return false;
  }
  if (trimmed.endsWith('?')) {
    return true;
  }
  const first = trimmed.split(/[^a-z]+/i)[0]?.toLowerCase();
  return first !== undefined && QUESTION_WORDS.includes(first);
}

/**
 * A {@link CapabilityMatcher} with a deterministic knowledge-question
 * fallback (see module docs). Delegates to the base matcher; when it
 * returns no matches and the intent is a question, the registered
 * knowledge capability is returned.
 */
export class KnowledgeFallbackMatcher extends CapabilityMatcher {
  readonly #knowledgeCapabilityId: string;
  readonly #minQuestionLength: number;

  constructor(options: KnowledgeFallbackMatcherOptions = {}) {
    super();
    this.#knowledgeCapabilityId = options.knowledgeCapabilityId ?? 'knowledge.search';
    this.#minQuestionLength = options.minQuestionLength ?? 8;
  }

  override match(intent: string, candidates: readonly CapabilityDeclaration[]): CapabilityScore[] {
    const scores = super.match(intent, candidates);
    if (scores.length > 0) {
      return scores;
    }
    if (!isKnowledgeQuestion(intent, this.#minQuestionLength)) {
      return [];
    }
    const knowledge = candidates.find(
      (capability) => capability.id === this.#knowledgeCapabilityId,
    );
    if (knowledge === undefined) {
      return [];
    }
    return [
      {
        capabilityId: knowledge.id,
        // A fallback confidence well below any real token match — real
        // matches always win; the fallback only fires on zero matches.
        score: 0.1,
        matchedTerms: [],
      },
    ];
  }
}
