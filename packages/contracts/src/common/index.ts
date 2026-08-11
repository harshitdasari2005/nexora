/**
 * @nexora/contracts — common types.
 *
 * Cross-cutting contracts: identifiers, timestamps, pagination, sorting, and
 * filtering (API_CONTRACTS.md §11). These are the vocabulary every contract
 * category shares.
 *
 * This module is type-only. ID *values* are created with
 * `@nexora/shared/ids` (`prefixedId`); the branded types here declare the
 * contract those values satisfy.
 */

/**
 * A branded platform entity id. Values are created with
 * `@nexora/shared/ids` `prefixedId(prefix)`; the brand prevents accidental
 * use of raw strings as ids.
 *
 * @typeParam T - the entity kind, e.g. `'employee'`, `'tenant'`, `'user'`.
 */
export type EntityId<T extends string = string> = string & { readonly __entity: T };

/** A tenant (company) id. */
export type TenantId = EntityId<'tenant'>;

/** A workspace id. */
export type WorkspaceId = EntityId<'workspace'>;

/** A user id. */
export type UserId = EntityId<'user'>;

/**
 * ISO-8601 UTC timestamp. Values are created with `@nexora/shared/time`
 * (`nowIso`/`toIso`).
 */
export type Timestamp = string;

/**
 * A correlation id tying an execution across services and events (SAD.md
 * §11.6). Values are created with `@nexora/shared/ids` `correlationId()`.
 */
export type CorrelationId = string;

/** A semantic version string, e.g. `1.2.3` (SAD.md §7.10). */
export type SemVer = string;

/**
 * A versioned value for configuration and settings; `version` is bumped on
 * every change for optimistic concurrency (BKD.md §11 configuration).
 */
export interface VersionedValue<T> {
  /** The configured value. */
  value: T;
  /** Monotonic version of this configuration entry. */
  version: number;
}

/**
 * Cursor-based page request (API_CONTRACTS.md §11.1). `cursor` is opaque and
 * server-generated; `limit` is bounded by the platform max page size.
 */
export interface PageRequest {
  /** Opaque continuation token from the previous page, when present. */
  cursor?: string;
  /** Maximum items to return; clamped by the platform (MAX_PAGE_SIZE). */
  limit?: number;
}

/**
 * A page of results. `items` is always the current page; `nextCursor` is
 * present when more results exist, and `total` is provided when the query
 * supports it (may be absent for expensive aggregations).
 */
export interface Page<T> {
  /** The items on this page. */
  items: readonly T[];
  /** Opaque continuation token for the next page, when more exist. */
  nextCursor?: string;
  /** Total matching items, when the query supports counting. */
  total?: number;
}

/** Sort direction. */
export type SortDirection = 'asc' | 'desc';

/** A single sort clause: field name plus direction. */
export interface SortClause {
  /** Field path to sort by. */
  field: string;
  /** Sort direction. */
  direction: SortDirection;
}

/** Common filter operator for scalar field filters. */
export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

/** A single field filter: operator plus operand(s). */
export interface FieldFilter {
  /** Field path to filter on. */
  field: string;
  /** Filter operator. */
  operator: FilterOperator;
  /** Operand(s); `in` uses the array form. */
  value: string | number | boolean | readonly (string | number | boolean)[];
}

/** A list/query request combining pagination, filtering, and sorting. */
export interface QueryRequest extends PageRequest {
  /** Field filters to apply. */
  filters?: readonly FieldFilter[];
  /** Sort clauses to apply. */
  sort?: readonly SortClause[];
}

/**
 * Metadata attached to every persisted entity (PERSISTENCE.md §4).
 */
export interface EntityMeta {
  /** ISO-8601 UTC time the entity was created. */
  createdAt: Timestamp;
  /** Id of the actor that created the entity. */
  createdBy: string;
  /** ISO-8601 UTC time the entity was last updated. */
  updatedAt: Timestamp;
  /** Id of the actor that last updated the entity. */
  updatedBy: string;
  /** Monotonic version used for optimistic concurrency. */
  version: number;
}

/**
 * A nullable/optional value wrapper for JSON payloads that must distinguish
 * "absent" from "null". Use sparingly; prefer optional fields otherwise.
 */
export type Maybe<T> = T | null | undefined;
