/**
 * @nexora/ai-runtime — retry policy.
 *
 * Retry behavior for tool execution (AIR.md §10.5, ER-2): idempotent tools
 * retry transient failures with backoff; non-idempotent tools never
 * auto-retry — they surface to human decision (FR-13).
 */

/** A retryable error signature. */
export interface RetryableError {
  /** Stable error code. */
  code: string;
  /** Human-readable message. */
  message: string;
}

/** A retry policy: how many attempts and which errors are retryable. */
export interface RetryPolicy {
  /** Maximum attempts including the first. */
  maxAttempts: number;
  /** Base backoff between attempts, in milliseconds. */
  backoffMs: number;
  /** Whether the error is transient and safe to retry. */
  isRetryable(error: RetryableError): boolean;
  /** Delay before the given attempt (1-based), with jitter. */
  delayForAttempt(attempt: number): number;
}

/**
 * Default retryable error codes. Thrown (unexpected) tool failures normalize
 * to `INTERNAL_ERROR` and are retryable for idempotent tools (ER-2: transient
 * tool failure → retry with backoff); typed, intentional failures are never
 * retried.
 */
const DEFAULT_RETRYABLE_CODES = new Set([
  'UNAVAILABLE',
  'TIMEOUT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);

/** Options for {@link defaultRetryPolicy}. */
export interface DefaultRetryPolicyOptions {
  /** Maximum attempts. Default 3. */
  maxAttempts?: number;
  /** Base backoff, in milliseconds. Default 100. */
  backoffMs?: number;
  /** Additional retryable error codes. */
  extraRetryableCodes?: readonly string[];
}

/** The default retry policy: transient codes only, capped attempts, jittered backoff. */
export function defaultRetryPolicy(options: DefaultRetryPolicyOptions = {}): RetryPolicy {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 100;
  const retryable = new Set([...DEFAULT_RETRYABLE_CODES, ...(options.extraRetryableCodes ?? [])]);
  return {
    maxAttempts,
    backoffMs,
    isRetryable: (error) => retryable.has(error.code),
    delayForAttempt: (attempt) => {
      const exponential = backoffMs * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * exponential * 0.25);
      return exponential + jitter;
    },
  };
}

/** A no-retry policy (non-idempotent tools, AIR.md §10.6). */
export const noRetryPolicy: RetryPolicy = {
  maxAttempts: 1,
  backoffMs: 0,
  isRetryable: () => false,
  delayForAttempt: () => 0,
};

/** Sleeps for the given number of milliseconds (test-injectable via timer mock). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
