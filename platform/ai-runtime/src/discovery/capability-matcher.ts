/**
 * @nexora/ai-runtime — capability matcher.
 *
 * The intent → capability matching stage (AIR.md §7 stage 4): ranks
 * candidate capabilities for a user intent under the user's permissions.
 * Matching is a deterministic, provider-independent scoring pass — the LLM
 * ranking strategy plugs in at the {@link PlanningStrategy} level, never in
 * discovery (deterministic orchestration, AIR.md §7).
 */

import type { CapabilityDeclaration } from '@nexora/contracts/ai';

/** A scored capability match, highest score first. */
export interface CapabilityScore {
  /** The matched capability id. */
  capabilityId: string;
  /** Match score, 0..1. */
  score: number;
  /** Intent tokens that matched the capability description. */
  matchedTerms: readonly string[];
}

/** Tokenizes a phrase into lowercase, deduplicated significant tokens. */
export function tokenize(phrase: string): string[] {
  const tokens = phrase
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
  return [...new Set(tokens)];
}

/** Options for {@link CapabilityMatcher}. */
export interface CapabilityMatcherOptions {
  /** Minimum score for a capability to be returned. Default 0. */
  minScore?: number;
  /** Maximum matches returned. Default 10. */
  maxResults?: number;
}

/**
 * A deterministic token-overlap matcher: scores a capability by the fraction
 * of its description tokens present in the intent. Used by the discovery
 * service to rank candidates before the planner synthesizes a plan.
 *
 * **Entity-noun evidence rule.** Capability names follow a "Verb Noun"
 * shape ("Create project", "List workspaces"). The noun is the entity the
 * capability operates on — the discriminating signal. Generic verbs
 * (create/list/get/add) are shared across capabilities and must never be
 * the basis of a match: without this rule, "Create a project…" would also
 * match "Create workspace" (both contain `create`), producing phantom
 * gated steps that can never resolve the intended approval. A capability is
 * therefore matched only when at least one of its name's noun tokens is
 * evidenced in the intent (the leading verb is optional).
 *
 * **Verb disambiguation rule.** Nouns can be *shared* across capabilities
 * ("Create project" vs "Assign employee to project" both operate on
 * `project`), so noun evidence alone is not discriminating: "Assign Sarah
 * to the Mobile Banking project" evidences the noun `project` and would
 * also match "Create project", adding a phantom gated step. A capability
 * whose noun is shared by any other candidate therefore also requires its
 * own leading verb to be evidenced in the intent ("assign" here). A
 * capability whose noun is unique needs no verb evidence — "What
 * workspaces do I have?" matches "List workspaces" without the word
 * "list".
 */
export class CapabilityMatcher {
  readonly #minScore: number;
  readonly #maxResults: number;

  constructor(options: CapabilityMatcherOptions = {}) {
    this.#minScore = options.minScore ?? 0;
    this.#maxResults = options.maxResults ?? 10;
  }

  /**
   * Matches an intent against candidate capabilities.
   *
   * @param intent      - the user intent.
   * @param candidates  - permission-filtered candidate capabilities.
   */
  match(intent: string, candidates: readonly CapabilityDeclaration[]): CapabilityScore[] {
    const intentTokens = tokenize(intent);
    if (intentTokens.length === 0) {
      return [];
    }

    const scored: CapabilityScore[] = [];
    for (const capability of candidates) {
      // Entity-noun evidence: the capability name's noun must be in the
      // intent. The leading verb is excluded so shared verbs cannot create
      // phantom matches between entity-disjoint capabilities.
      const nameTokens = tokenize(capability.name);
      const [verbToken, ...nounTokens] = nameTokens;
      const hasEntityEvidence = nounTokens.some((token) => intentTokens.includes(token));
      if (!hasEntityEvidence) {
        continue;
      }
      // Verb disambiguation: when another candidate shares this capability's
      // noun (e.g. "create project" vs "assign employee to project"), the
      // intent must also evidence THIS capability's leading verb. A unique
      // noun needs no verb evidence ("What workspaces do I have?").
      const verbEvidenced = verbToken !== undefined && intentTokens.includes(verbToken);
      const nounShared = nounTokens.some((token) =>
        candidates.some((other) => {
          if (other === capability) {
            return false;
          }
          return tokenize(other.name).slice(1).includes(token);
        }),
      );
      if (nounShared && !verbEvidenced) {
        continue;
      }
      // Score on the semantic descriptors only (name + description) — ids are
      // namespaced keys and pollute matching with shared tokens (AIR.md §5.1
      // capability manifest: examples and constraints, not identifiers).
      const descriptionTokens = tokenize(`${capability.name} ${capability.description}`);
      const matchedTerms = descriptionTokens.filter((token) => intentTokens.includes(token));
      const score =
        descriptionTokens.length === 0 ? 0 : matchedTerms.length / descriptionTokens.length;
      if (score >= this.#minScore && matchedTerms.length > 0) {
        scored.push({ capabilityId: capability.id, score, matchedTerms });
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, this.#maxResults);
  }
}
