/**
 * @nexora/module-search — search index port.
 *
 * The persistence seam of the Search platform (PERSISTENCE.md §7 search
 * projection). Implementations store {@link SearchIndexEntry} projections
 * and answer BR-7-filtered queries. The port is intentionally small: put,
 * remove-by-scope, and scope-filtered query. Replaceable (in-memory for
 * tests/local, Drizzle over PostgreSQL in the app).
 */

import type { SearchIndexEntry, SearchQueryFilter } from './search-index-entry.js';

/** The search index persistence port (projection store). */
export interface SearchIndexPort {
  /** Indexes (inserts or replaces) one entry. */
  put(entry: SearchIndexEntry): Promise<void>;

  /**
   * Removes every entry of a scope within a tenant (e.g. an archived
   * document must leave the index — stale entries never answer).
   */
  removeByScope(scopeId: string, tenantId: string): Promise<void>;

  /**
   * Runs a scope-filtered lexical query. The filter's tenantId + workspaceId
   * are MANDATORY: implementations must never return entries outside the
   * requested scope.
   */
  query(filter: SearchQueryFilter): Promise<readonly SearchIndexEntry[]>;
}
