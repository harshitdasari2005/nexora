/**
 * @nexora/module-search — lexical scoring.
 *
 * The deterministic lexical retrieval path (vertical slice v1): token
 * overlap scoring over title + normalized text. No embeddings, no vectors,
 * no external services — the seam where a vector provider can later plug in
 * without touching the permission filter (scope filtering happens OUTSIDE
 * scoring, always).
 *
 * Scoring is pure and deterministic: title tokens weigh 2×, text tokens 1×;
 * ties break by index recency then stable id.
 */

import type { SearchIndexEntry } from './search-index-entry.js';

/** A small stop-word list (case-insensitive; keeps scoring useful). */
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'was',
  'were',
  'what',
  'does',
  'say',
  'about',
  'do',
  'it',
  'its',
]);

/** Tokenizes text into lowercased, non-stopword terms. */
export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

/**
 * Scores one entry against the query tokens (0 when nothing matches).
 * Title tokens weigh 2×; text tokens 1× — a title match ranks above a
 * body-only match, which makes citations surface the most relevant title.
 */
export function scoreEntry(entry: SearchIndexEntry, tokens: readonly string[]): number {
  if (tokens.length === 0) {
    return 0;
  }
  const titleTokens = new Set(tokenize(entry.title));
  const textTokens = new Set(tokenize(entry.text));
  let score = 0;
  for (const token of tokens) {
    if (titleTokens.has(token)) {
      score += 2;
    }
    if (textTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Ranks entries by relevance, deterministically: score desc, then indexedAt
 * desc, then id asc. The result is bounded to `limit`.
 */
export function rankEntries(
  entries: readonly SearchIndexEntry[],
  tokens: readonly string[],
  limit: number,
): readonly SearchIndexEntry[] {
  return [...entries]
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const byTime = b.entry.indexedAt.localeCompare(a.entry.indexedAt);
      if (byTime !== 0) {
        return byTime;
      }
      return a.entry.id.localeCompare(b.entry.id);
    })
    .slice(0, limit)
    .map((ranked) => ranked.entry);
}
