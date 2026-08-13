/**
 * @nexora/module-search — search index entry.
 *
 * The generic projection entry of the Search bounded context (DOMAIN_MODEL.md
 * §15: SearchIndexEntry projection, BR-7-filtered queries). The Search
 * platform is a *generic* projection service: it stores opaque `{ scope,
 * title, text }` entries and never interprets business meaning. Domain
 * modules (Knowledge) own their entries — Search only indexes what they put
 * and answers only queries filtered by tenant + workspace scope.
 */

/** The canonical kinds of indexed content (S18: documents + KB articles). */
export const SEARCH_ENTRY_KINDS = {
  document: 'document',
  article: 'article',
} as const;

/** The kind of an indexed entry. */
export type SearchEntryKind = (typeof SEARCH_ENTRY_KINDS)[keyof typeof SEARCH_ENTRY_KINDS];

/**
 * A searchable index entry (DOMAIN_MODEL.md SearchIndexEntry projection).
 * `tenantId` + `workspaceId` are the AUTHORIZATION scope — a query can only
 * ever see entries inside the caller's tenant/workspace; the model can never
 * widen that scope.
 */
export interface SearchIndexEntry {
  /** Stable entry id (the owning knowledge source id). */
  id: string;
  /** The owning tenant (organization) id — immutable scope. */
  tenantId: string;
  /** The owning workspace id — immutable scope. */
  workspaceId: string;
  /** The owning business entity id (e.g. the source document or article id). */
  scopeId: string;
  /** The content kind (`document` | `article`). */
  kind: SearchEntryKind;
  /** The display title (used for citations). */
  title: string;
  /** The normalized, searchable text (never full raw file bytes). */
  text: string;
  /** The indexed content version (stale entries never answer). */
  version: number;
  /** ISO-8601 UTC index time. */
  indexedAt: string;
}

/** The query filter — scope is REQUIRED (never optional, never model-supplied). */
export interface SearchQueryFilter {
  /** The trusted tenant id (from the authenticated context). */
  tenantId: string;
  /** The trusted workspace id (from the authenticated context). */
  workspaceId: string;
  /** The user's search text. */
  query: string;
  /** Max results (bounded; default 5, clamped to 20). */
  limit?: number;
  /**
   * Scope ids to exclude (e.g. archived documents). The caller computes the
   * exclusion list from TRUSTED data — never from the model.
   */
  excludeScopeIds?: readonly string[];
}

/** The maximum number of results a query may return (performance bound). */
export const SEARCH_RESULT_LIMIT_MAX = 20;
/** The default number of results returned. */
export const SEARCH_RESULT_LIMIT_DEFAULT = 5;
