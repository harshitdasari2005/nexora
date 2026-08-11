/**
 * @nexora/contracts — query contracts.
 *
 * Read-model contracts (CQRS, BKD.md §8): queries are side-effect-free,
 * never mutate state, and return projections. Filtering, sorting, and
 * pagination follow API_CONTRACTS.md §11.
 */

import type { PageRequest, SortClause, Timestamp } from '../common/index.js';

/** Filter operators supported by query APIs (API_CONTRACTS.md §11). */
export type QueryFilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

/** A single query filter clause. */
export interface QueryFilter {
  /** Field path to filter on. */
  field: string;
  /** Filter operator. */
  operator: QueryFilterOperator;
  /** Operand(s); `in` uses the array form. */
  value: string | number | boolean | readonly (string | number | boolean)[];
}

/** Filtering contract for a query: a conjunctive list of clauses. */
export interface QueryFilters {
  /** Clauses; all must match (AND). */
  and: readonly QueryFilter[];
}

/** Sorting contract for a query: ordered sort clauses. */
export interface QuerySorting {
  /** Sort clauses, applied in order. */
  by: readonly SortClause[];
}

/**
 * Pagination contract for a query. `cursor` is opaque and server-generated;
 * `limit` is bounded by the platform max page size (API_CONTRACTS.md §11.1).
 */
export interface QueryPagination extends PageRequest {
  /** Opaque continuation token from the previous page, when present. */
  cursor?: string;
  /** Maximum items to return. */
  limit?: number;
}

/**
 * Projection contract: which fields the caller wants. When absent, the
 * default projection for the query applies.
 */
export interface QueryProjection {
  /** Field paths to include. */
  fields?: readonly string[];
}

/**
 * The base query contract. Concrete queries extend this with typed
 * `criteria` payloads.
 */
export interface BaseQuery<TCriteria = unknown> {
  /** Query name, e.g. `projects.search`. */
  name: string;
  /** Filters (optional). */
  filters?: QueryFilters;
  /** Sorting (optional). */
  sorting?: QuerySorting;
  /** Pagination (optional). */
  pagination?: QueryPagination;
  /** Projection (optional). */
  projection?: QueryProjection;
  /** Query criteria, typed by the concrete query. */
  criteria: TCriteria;
}

/**
 * The result of executing a query: a page of projected items plus query
 * metadata.
 */
export interface QueryResult<TItem> {
  /** The items on this page. */
  items: readonly TItem[];
  /** Opaque continuation token for the next page, when more exist. */
  nextCursor?: string;
  /** Total matching items, when the query supports counting. */
  total?: number;
  /** ISO-8601 UTC time the result set was produced. */
  servedAt: Timestamp;
}
