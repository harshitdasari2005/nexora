/**
 * @nexora/app-web — API client.
 *
 * A tiny typed fetch wrapper. Requests go to the same origin under `/api`
 * (proxied to the monolith in dev), credentials are always included, and
 * errors are normalized to {@link ApiError} using the canonical error
 * taxonomy (API_CONTRACTS.md §10).
 */

/** A normalized API error. */
export class ApiError extends Error {
  /** HTTP status code. */
  readonly status: number;
  /** Canonical error code. */
  readonly code: string;
  /** The originating request id, when provided. */
  readonly requestId?: string;
  /** Structured details (field issues, entity ids). */
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }

  /** Whether this error represents an unauthenticated session (401). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; requestId?: string; details?: unknown };
}

/**
 * Performs an authenticated JSON request against the API.
 *
 * @param path - API path without the `/api` prefix (e.g. `/me`).
 * @param init - fetch options (merged over the defaults).
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    // Only set `content-type: application/json` when a body is actually
    // sent — a bodyless POST (e.g. an action with no payload) with this
    // header still set reaches the server as a zero-length JSON body,
    // which Fastify's parser rejects (FST_ERR_CTP_EMPTY_JSON_BODY).
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const body = (await response.json().catch(() => undefined)) as (T & ApiErrorBody) | undefined;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'INTERNAL_ERROR',
      body?.error?.message ?? 'Request failed',
      body?.error?.requestId,
      body?.error?.details,
    );
  }
  // Something was changed on the server: let anything that shows shared state
  // (the guided story, the desk) read it again instead of going stale.
  if (init.method !== undefined && init.method.toUpperCase() !== 'GET') announceChange();
  return body as T;
}

/** The browser event fired after every successful change made through {@link api}. */
export const CHANGE_EVENT = 'nexora:changed';

function announceChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}
