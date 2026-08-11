/**
 * @nexora/ai-runtime — timeout policy.
 *
 * Per-tool timeout budgets (AIR.md §10.5): a timed-out invocation is
 * classified as transient and may be retried (idempotent tools) or escalated.
 * The timeout releases the caller; in-flight work cannot be cancelled.
 */

import { TimeoutError } from '@nexora/shared/errors';

/** A timeout policy: the maximum wall-clock budget for one invocation. */
export interface TimeoutPolicy {
  /** The timeout budget, in milliseconds. `<= 0` disables the timeout. */
  timeoutMs: number;
  /** Runs `work` under the timeout, rejecting with {@link TimeoutError} on expiry. */
  run<T>(work: () => Promise<T>): Promise<T>;
}

/** A fixed-millisecond timeout policy. */
export class FixedTimeoutPolicy implements TimeoutPolicy {
  /**
   * @param timeoutMs - the budget in milliseconds; `<= 0` disables it.
   */
  constructor(public readonly timeoutMs: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.timeoutMs <= 0) {
      return work();
    }
    let handle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      handle = setTimeout(
        () => reject(new TimeoutError(`Operation exceeded ${this.timeoutMs}ms budget`)),
        this.timeoutMs,
      );
    });
    try {
      return await Promise.race([work(), timeout]);
    } finally {
      if (handle !== undefined) {
        clearTimeout(handle);
      }
    }
  }
}

/** A policy with no timeout (test/embedded use). */
export const noTimeoutPolicy: TimeoutPolicy = {
  timeoutMs: 0,
  run: (work) => work(),
};
