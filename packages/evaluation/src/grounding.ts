/**
 * @nexora/evaluation — deterministic grounding checker.
 *
 * Decides whether a response stays within what the platform actually
 * retrieved and did. It is a LEXICAL heuristic, deliberately simple and
 * fully deterministic (no model judges another model) — so its verdicts are
 * reproducible and explainable, and its limits are explicit:
 *
 * - Claims it extracts:
 *   1. entity claims — any named value from the scenario world (project,
 *      employee, budget, event, article, document, organization names) the
 *      response mentions;
 *   2. numeric claims — multi-digit numbers, percentages, and amounts;
 *   3. action claims — past-tense completion verbs ("created", "scheduled",
 *      "hired", …) that are not negated/conditional.
 * - A claim is SUPPORTED when:
 *   - entity/numeric: the value appears in the grounding context (the user
 *     message, retrieved snippets, or tool outputs);
 *   - action: a step of the matching capability family actually succeeded.
 * - It cannot judge paraphrased semantics; it catches fabricated entities,
 *   invented numbers, cross-tenant leakage, and claimed-but-not-performed
 *   actions — the failure classes the evaluation targets.
 */

/** One extracted claim and its verdict. */
export interface GroundingClaim {
  kind: 'entity' | 'numeric' | 'action';
  value: string;
  supported: boolean;
}

/** Inputs of {@link checkGrounding}. */
export interface GroundingInput {
  response: string;
  /** Texts the response may rely on (user message, snippets, tool outputs). */
  context: readonly string[];
  /** The world's named values (entity names/titles) — the entity-claim vocabulary. */
  vocabulary: readonly string[];
  /** Capability ids whose steps SUCCEEDED (supports action claims). */
  succeededCapabilities: readonly string[];
  /** Whether an approval decision was granted (supports "approved"). */
  approvalGranted: boolean;
  requiredFacts: readonly string[];
  forbiddenValues: readonly string[];
  /** When set, the response must (true) acknowledge a failure/refusal. */
  acknowledgesFailure?: boolean;
  /** The tolerated unsupported-claim rate (default 0). */
  maxUnsupportedClaimRate?: number;
}

/** The grounding verdict. */
export interface GroundingResult {
  claims: readonly GroundingClaim[];
  totalClaims: number;
  unsupportedClaims: number;
  /** unsupported ÷ total (0 when no claims were made). */
  unsupportedClaimRate: number;
  missingFacts: readonly string[];
  forbiddenFound: readonly string[];
  failureAcknowledged: boolean;
  /** Human-readable reasons for any failure (empty when all checks hold). */
  failures: readonly string[];
}

/**
 * Completion verbs → the capability families that can support them. A claim
 * is supported only by a SUCCEEDED step whose capability id contains one of
 * the listed fragments.
 */
const ACTION_VERBS: Readonly<Record<string, readonly string[]>> = {
  created: ['create', 'workflow.'],
  scheduled: ['calendar.create_event'],
  booked: ['calendar.create_event'],
  hired: ['hr.create_employee', 'workflow.hire_and_assign_employee'],
  onboarded: ['hr.create_employee', 'workflow.hire_and_assign_employee'],
  assigned: ['projects.assign_employee', 'workflow.'],
  submitted: ['finance.submit_expense'],
  flagged: ['finance.flag_over_budget_items'],
  marked: ['notifications.mark_all_read'],
  sent: ['slack.messages.send'],
  posted: ['slack.messages.send', 'github.issues.create'],
  opened: ['github.issues.create'],
  // Supported only by a granted approval decision (see checkGrounding).
  approved: [],
};

/** Words that make a following completion verb non-assertive. */
const NON_ASSERTIVE = new Set([
  'not',
  "n't",
  'never',
  'no',
  'nothing',
  'without',
  'until',
  'before',
  'once',
  'after',
  'will',
  'would',
  'can',
  'could',
  'cannot',
  'to',
  'be',
  'need',
  'needs',
  'requires',
  'require',
  'pending',
  'awaiting',
  'if',
  'when',
  'unless',
  'should',
  'must',
]);

/** Failure/refusal acknowledgement lexicon (generic — never an exact message). */
const FAILURE_PATTERN =
  /\b(couldn['’]t|could not|can['’]t|cannot|unable|fail(?:ed|ure|s)?|error|not able|did not|didn['’]t|wasn['’]t|was not|reject(?:ed|ion)?|declined|denied|not permitted|no permission|don['’]t have|do not have|unavailable|not found|not available|no (?:matching|relevant))\b/i;

/** Multi-digit numbers, amounts, and percentages. */
const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?%?/g;

/**
 * Machine output, never prose assertions: ISO-8601 timestamps (their digits
 * move with the clock), prefixed/bare UUIDs (`bud_<uuid>`), and
 * dotted/underscored identifiers (capability ids).
 */
const IDENTIFIER_PATTERN =
  /\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?|(?:[a-z]+_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[a-z0-9._]*[a-z_])[a-z0-9]+(?:[._][a-z0-9]+)+/g;

/** Checks a response's grounding (pure, deterministic). */
export function checkGrounding(input: GroundingInput): GroundingResult {
  // Claims are made in prose: machine identifiers (capability ids, entity
  // ids, UUIDs) are references, not assertions, and must never read as an
  // entity ("finance.flag_…" is not a mention of a "Finance" workspace).
  const response = normalize(input.response).replace(IDENTIFIER_PATTERN, ' ');
  const context = input.context.map(normalize).join('\n');
  const contextDigits = context.replace(/,/g, '');
  const claims: GroundingClaim[] = [];

  // 1. entity claims — world vocabulary mentioned by the response.
  const seen = new Set<string>();
  for (const raw of input.vocabulary) {
    const value = normalize(raw);
    if (value.length < 4 || seen.has(value)) continue;
    seen.add(value);
    if (containsPhrase(response, value)) {
      claims.push({ kind: 'entity', value: raw, supported: containsPhrase(context, value) });
    }
  }

  // 2. numeric claims — multi-digit numbers / amounts / percentages.
  const numbers = new Set<string>();
  for (const match of response.matchAll(NUMBER_PATTERN)) {
    const value = match[0].replace(/,/g, '').replace(/\.$/, '');
    const digits = value.replace(/[^\d]/g, '');
    if (digits.length < 2 && !value.endsWith('%')) continue;
    if (numbers.has(value)) continue;
    numbers.add(value);
    claims.push({ kind: 'numeric', value, supported: contextDigits.includes(value) });
  }

  // 3. action claims — asserted past-tense completion verbs.
  const tokens = response.split(/[^a-z'’]+/).filter(Boolean);
  const claimedVerbs = new Set<string>();
  tokens.forEach((token, index) => {
    const families = ACTION_VERBS[token];
    if (families === undefined || claimedVerbs.has(token)) return;
    const window = tokens.slice(Math.max(0, index - 4), index);
    if (window.some((word) => NON_ASSERTIVE.has(word) || word.endsWith("n't"))) return;
    claimedVerbs.add(token);
    const supported =
      token === 'approved'
        ? input.approvalGranted
        : input.succeededCapabilities.some((capability) =>
            families.some((fragment) => capability.includes(fragment)),
          );
    claims.push({ kind: 'action', value: token, supported });
  });
  const unsupportedClaims = claims.filter((claim) => !claim.supported).length;
  const unsupportedClaimRate = claims.length === 0 ? 0 : unsupportedClaims / claims.length;
  const missingFacts = input.requiredFacts.filter(
    (fact) => !containsPhrase(response, normalize(fact)),
  );
  const forbiddenFound = input.forbiddenValues.filter((value) =>
    containsPhrase(response, normalize(value)),
  );
  const failureAcknowledged = FAILURE_PATTERN.test(input.response);

  const failures: string[] = [];
  if (missingFacts.length > 0) failures.push(`missing facts: ${missingFacts.join('; ')}`);
  if (forbiddenFound.length > 0) failures.push(`forbidden values: ${forbiddenFound.join('; ')}`);
  if (unsupportedClaimRate > (input.maxUnsupportedClaimRate ?? 0)) {
    failures.push(
      `unsupported claims: ${claims
        .filter((claim) => !claim.supported)
        .map((claim) => `${claim.kind}:${claim.value}`)
        .join('; ')}`,
    );
  }
  if (input.acknowledgesFailure === true && !failureAcknowledged) {
    failures.push('the response does not acknowledge the failure/refusal');
  }

  return {
    claims,
    totalClaims: claims.length,
    unsupportedClaims,
    unsupportedClaimRate,
    missingFacts,
    forbiddenFound,
    failureAcknowledged,
    failures,
  };
}

/** Lower-cases and folds dashes/quotes/whitespace so formatting never decides a verdict. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-phrase containment (word boundaries on both ends). */
function containsPhrase(haystack: string, phrase: string): boolean {
  if (phrase.length === 0) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(haystack);
}
