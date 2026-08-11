/**
 * @nexora/contracts — API contracts.
 *
 * Request/response envelopes, the standard error body, pagination payloads,
 * correlation, and idempotency (API_CONTRACTS.md §10-11). Every API category
 * returns one of these envelopes; the `data` field is always present on
 * success and the `error` body always carries the stable code, a human
 * message, and a correlation id for support tracing.
 *
 * The canonical `ApiErrorCode` literal mirrors the runtime `ERROR_CODES`
 * array in `@nexora/shared/constants` (keep both in sync).
 */

import type { CorrelationId } from '../common/index.js';

/**
 * Canonical platform error codes, aligned with the API error taxonomy
 * (API_CONTRACTS.md §10). Runtime array: `ERROR_CODES` in
 * `@nexora/shared/constants`.
 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE_VIOLATION'
  | 'POLICY_VIOLATION'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'INTERNAL_ERROR';

/**
 * A field-scoped error detail returned by the API.
 */
export interface ApiFieldError {
  /** Dot-separated field path, e.g. `employee.email`. */
  path: string;
  /** Human-readable message for the field. */
  message: string;
}

/**
 * The standard error body (API_CONTRACTS.md §10). `code` is a stable
 * platform error code; `correlationId` lets support trace the failing
 * request.
 */
export interface ApiErrorBody {
  /** Stable machine-readable code. */
  code: ApiErrorCode;
  /** Human-readable summary. */
  message: string;
  /** Field-scoped issues, present for validation errors. */
  fieldErrors?: readonly ApiFieldError[];
  /** Optional structured details. */
  details?: unknown;
  /** Id used to correlate the error to logs/traces. */
  correlationId: CorrelationId;
}

/** Successful API response envelope. */
export interface ApiSuccess<T> {
  /** Always `true` on success. */
  ok: true;
  /** The payload of the response. */
  data: T;
}

/** Failed API response envelope. */
export interface ApiFailure {
  /** Always `false` on failure. */
  ok: false;
  /** The standard error body. */
  error: ApiErrorBody;
}

/** Union of API response envelopes; discriminate with the `ok` field. */
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/**
 * A paginated payload as returned inside {@link ApiSuccess}.
 */
export interface ApiPage<T> {
  /** The items on this page. */
  items: readonly T[];
  /** Opaque continuation token for the next page, when more exist. */
  nextCursor?: string;
  /** Total matching items, when the query supports counting. */
  total?: number;
}

/**
 * An idempotency-key header contract (BKD.md §8.2). Clients send the same key
 * when retrying a command so the platform can deduplicate.
 */
export interface IdempotencyHeader {
  /** Client-generated key unique per operation. */
  'x-idempotency-key': string;
}

/**
 * Acknowledgment payload for commands that produce no meaningful result body.
 */
export interface ApiAck {
  /** Id of the created/updated resource, when applicable. */
  id?: string;
  /** Human-readable acknowledgment. */
  message: string;
}
