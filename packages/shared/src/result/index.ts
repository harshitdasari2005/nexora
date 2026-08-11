/**
 * @nexora/shared — Result<T, E> pattern.
 *
 * Domain and application logic returns `Result` instead of throwing for
 * expected failures (validation, policy, conflicts). This keeps control flow
 * explicit and makes error handling a first-class value (BKD.md §4, §14;
 * ENGINEERING_PLAYBOOK.md §4.2). Use {@link ok} and {@link err} to construct.
 */

/**
 * The success variant of a {@link Result}. Carries a value of type `T`.
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/**
 * The failure variant of a {@link Result}. Carries an error of type `E`.
 */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * Discriminated union returned by fallible operations.
 * Discriminate with the `ok` field, or use the helpers below.
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/** Constructs a success {@link Result} carrying `value`. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true as const, value };
}

/** Constructs a failure {@link Result} carrying `error`. */
export function err<E>(error: E): Err<E> {
  return { ok: false as const, error };
}

/** Narrowing guard: true when the result is a success. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Narrowing guard: true when the result is a failure. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/**
 * Maps a success value with `fn`. Accepts only the {@link Ok} variant: narrow
 * with {@link isOk} first when handling a general {@link Result}. This keeps
 * the callback's parameter type always inferrable (TypeScript cannot infer a
 * type parameter that is never observed in the applicable branch).
 *
 * @example
 * ```ts
 * if (isOk(result)) {
 *   const doubled = map(result, (value) => value * 2); // Ok<number>
 * }
 * ```
 */
export function map<T, U>(result: Ok<T>, fn: (value: T) => U): Ok<U> {
  return ok(fn(result.value));
}

/**
 * Maps a failure with `fn`. Accepts only the {@link Err} variant: narrow with
 * {@link isErr} first when handling a general {@link Result} (same inference
 * reason as {@link map}).
 *
 * @example
 * ```ts
 * if (isErr(result)) {
 *   const wrapped = mapErr(result, (message) => new Error(message));
 * }
 * ```
 */
export function mapErr<E, F>(result: Err<E>, fn: (error: E) => F): Err<F> {
  return err(fn(result.error));
}

/**
 * Extracts the success value or throws the failure.
 * Prefer {@link unwrapOr} or {@link match} in production paths; this is for
 * boundary code where a failure is a programming error.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

/**
 * Extracts the success value or returns `fallback` on failure.
 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  if (result.ok) {
    return result.value;
  }
  return fallback;
}

/**
 * Extracts the success value or invokes `onError` with the failure.
 */
export function unwrapOrElse<T, E>(result: Result<T, E>, onError: (error: E) => T): T {
  if (result.ok) {
    return result.value;
  }
  return onError(result.error);
}

/**
 * Pattern-matches both variants and returns the handler's result.
 *
 * @example
 * ```ts
 * const label = match(result, {
 *   ok: (value) => `value:${value}`,
 *   err: (error) => `error:${error.message}`,
 * });
 * ```
 */
export function match<T, E, R>(
  result: Result<T, E>,
  handlers: { ok: (value: T) => R; err: (error: E) => R },
): R {
  if (result.ok) {
    return handlers.ok(result.value);
  }
  return handlers.err(result.error);
}

/**
 * Converts a promise-producing function into a promise of {@link Result},
 * capturing synchronous throws and rejections as failures.
 *
 * The error type defaults to `Error`; pass a shared error hierarchy as the
 * second type argument when needed.
 *
 * @example
 * ```ts
 * const project = await promiseResult(() => repo.save(project));
 * ```
 */
export async function promiseResult<T, E = Error>(fn: () => Promise<T> | T): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (caught) {
    return err(caught as E);
  }
}
