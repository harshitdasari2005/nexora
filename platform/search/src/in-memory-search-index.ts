/**
 * @nexora/module-search — in-memory search index.
 *
 * The {@link SearchIndexPort} implementation for tests and local runs
 * (PERSISTENCE.md §7 projections). Scope is the FIRST filter: entries are
 * only ever considered inside the requested tenant + workspace, then the
 * caller's exclusions, then lexical ranking. Replaceable by the Drizzle
 * implementation in `@nexora/persistence` without touching callers.
 */

import { rankEntries, tokenize } from './lexical-search.js';
import {
  SEARCH_RESULT_LIMIT_DEFAULT,
  SEARCH_RESULT_LIMIT_MAX,
  type SearchIndexEntry,
  type SearchQueryFilter,
} from './search-index-entry.js';
import type { SearchIndexPort } from './search-index-port.js';

/** An in-memory {@link SearchIndexPort}. */
export class InMemorySearchIndex implements SearchIndexPort {
  readonly #entries = new Map<string, SearchIndexEntry>();

  /** The stored entries (test introspection). */
  get entries(): ReadonlyMap<string, SearchIndexEntry> {
    return this.#entries;
  }

  async put(entry: SearchIndexEntry): Promise<void> {
    this.#entries.set(entry.id, entry);
  }

  async removeByScope(scopeId: string, tenantId: string): Promise<void> {
    for (const [id, entry] of this.#entries) {
      if (entry.scopeId === scopeId && entry.tenantId === tenantId) {
        this.#entries.delete(id);
      }
    }
  }

  async query(filter: SearchQueryFilter): Promise<readonly SearchIndexEntry[]> {
    const limit = Math.min(
      Math.max(1, Math.trunc(filter.limit ?? SEARCH_RESULT_LIMIT_DEFAULT)),
      SEARCH_RESULT_LIMIT_MAX,
    );
    const excluded = new Set(filter.excludeScopeIds ?? []);
    // 1. AUTHORIZATION FIRST: the scope filter is mandatory — no entry
    //    outside the caller's tenant + workspace can ever be considered.
    const scoped = [...this.#entries.values()].filter(
      (entry) =>
        entry.tenantId === filter.tenantId &&
        entry.workspaceId === filter.workspaceId &&
        !excluded.has(entry.scopeId),
    );
    // 2. Deterministic lexical ranking over the authorized candidates only.
    return rankEntries(scoped, tokenize(filter.query), limit);
  }
}
