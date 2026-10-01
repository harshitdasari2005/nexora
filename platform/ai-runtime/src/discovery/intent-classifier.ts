/**
 * @nexora/ai-runtime — intent-kind classifier.
 *
 * Separates what the user is DOING with a sentence from which entity nouns
 * it mentions: asking for information ("What does the expense policy say
 * about approvals?"), asking for a recommendation ("Should I approve this
 * expense?"), or commanding a state change ("Submit an expense for 500").
 * Entity nouns alone cannot make that distinction — a policy question and an
 * expense submission both say "expense" — so the capability matcher consults
 * this classification before letting a state-changing capability match.
 *
 * Deterministic and provider-independent (AIR.md §7: no model decides
 * routing or authorization). The classifier only ever NARROWS what can
 * match: it can remove state-changing capabilities from the candidates of a
 * question; it can never add a capability or grant a permission. Every
 * mutation still passes the side-effect guard, authorization, and approval.
 *
 * Rules, in priority order:
 * 1. A polite request or stated need addressed to the assistant ("can you
 *    submit…", "please…", "I want to…", "go ahead and…") is an ACTION.
 * 2. A leading mutation verb ("Submit…", "Approve…") is an ACTION.
 * 3. A recommendation cue ("should I…", "what do you recommend", "suggest…")
 *    is a RECOMMENDATION.
 * 4. A question form (`?`, wh-word, "does/is/can I…", a leading read verb
 *    such as "show"/"list"/"explain") is INFORMATION.
 * 5. Anything else is UNSPECIFIED: the existing matching applies unchanged.
 */

/** What the user is doing with the sentence. */
export type IntentKind = 'information' | 'recommendation' | 'action' | 'unspecified';

/** Leading verbs that command a state change. */
const MUTATION_VERBS: ReadonlySet<string> = new Set([
  'add',
  'approve',
  'archive',
  'assign',
  'book',
  'cancel',
  'change',
  'close',
  'create',
  'delete',
  'edit',
  'file',
  'flag',
  'hire',
  'invite',
  'log',
  'mark',
  'move',
  'onboard',
  'open',
  'raise',
  'record',
  'register',
  'reject',
  'remove',
  'rename',
  'schedule',
  'send',
  'set',
  'submit',
  'update',
]);

/** Leading verbs that ask to read something back. */
const READ_VERBS: ReadonlySet<string> = new Set([
  'check',
  'describe',
  'explain',
  'find',
  'get',
  'give',
  'list',
  'look',
  'read',
  'search',
  'show',
  'summarise',
  'summarize',
  'tell',
]);

/** Words that open an information question. */
const QUESTION_WORDS: ReadonlySet<string> = new Set([
  'what',
  'whats',
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
  'am',
  'has',
  'have',
]);

/** Modal openers: a question about the user ("can I") or a request ("can you"). */
const MODALS: ReadonlySet<string> = new Set(['can', 'could', 'would', 'will', 'should', 'may']);

/** Filler words that may precede the real sentence. */
const FILLERS: ReadonlySet<string> = new Set(['hey', 'hi', 'hello', 'ok', 'okay', 'so', 'nexora']);

/** Phrases that state a need to act ("I want to submit…"). */
const NEED_PATTERN =
  /^(?:(?:i|we)\s+(?:would\s+like|want|need|wish|have)|(?:id|wed)\s+like)\s+to\s+(\w+)/;

/** Cues that ask for advice rather than an outcome. */
const RECOMMENDATION_PATTERN =
  /\b(?:should\s+(?:i|we)\b|what\s+should\s+(?:i|we)\b|recommend(?:ation|ations|ed)?\b|suggest(?:ion|ions|ed)?\b|advise\b|advice\b|do\s+you\s+(?:think|recommend|suggest)\b|would\s+you\s+(?:recommend|suggest)\b|is\s+it\s+(?:worth|wise|advisable|a\s+good\s+idea)\b)/;

/**
 * Classifies an intent. `information` and `recommendation` are read-only
 * intents; `action` may change state; `unspecified` keeps current behavior.
 */
export function classifyIntentKind(intent: string): IntentKind {
  const words = intent
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  while (words.length > 0 && FILLERS.has(words[0] as string)) {
    words.shift();
  }
  const first = words[0];
  if (first === undefined) {
    return 'unspecified';
  }

  const sentence = words.join(' ');
  const trimmedText = intent.trim();
  const isQuestionMark = trimmedText.endsWith('?');

  // 1. Requests and stated needs addressed to the assistant.
  if (first === 'please') {
    return MUTATION_VERBS.has(words[1] ?? '') ? 'action' : verbKind(words[1]);
  }
  if (first === 'lets' || (first === 'go' && words[1] === 'ahead')) {
    return 'action';
  }
  const need = NEED_PATTERN.exec(sentence);
  if (need !== null) {
    return MUTATION_VERBS.has(need[1] as string) ? 'action' : verbKind(need[1]);
  }
  if (MODALS.has(first) && words[1] === 'you') {
    // "can you submit…" is a command; "can you show…" is a read request.
    const verb = words[2] === 'please' ? words[3] : words[2];
    return MUTATION_VERBS.has(verb ?? '') ? 'action' : verbKind(verb);
  }

  // 2. Leading mutation verb (imperative).
  if (MUTATION_VERBS.has(first)) {
    return 'action';
  }

  // 3. Recommendation cues.
  if (RECOMMENDATION_PATTERN.test(sentence)) {
    return 'recommendation';
  }

  // 4. Question forms and read verbs.
  if (QUESTION_WORDS.has(first) || READ_VERBS.has(first) || isQuestionMark) {
    return 'information';
  }
  if (MODALS.has(first)) {
    // "can I / should we / may I …" — a question about the user's own options.
    return 'information';
  }
  return 'unspecified';
}

/** A read verb keeps `information`; any other verb leaves the intent unspecified. */
function verbKind(verb: string | undefined): IntentKind {
  return verb !== undefined && READ_VERBS.has(verb) ? 'information' : 'unspecified';
}

/** Whether an intent kind forbids state-changing capabilities from matching. */
export function isReadOnlyIntent(kind: IntentKind): boolean {
  return kind === 'information' || kind === 'recommendation';
}
