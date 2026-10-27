/**
 * @nexora/persistence — all-or-nothing writes across repositories.
 *
 * Some business steps write several records that only make sense together
 * (an accepted offer: the candidate, the opening's seat count and the new
 * employee). `createTransactionalDatabase` returns a database handle to build
 * those repositories from, and a `transaction` runner: every query the
 * repositories make while the runner's work is in flight goes through ONE
 * PostgreSQL transaction, so a failure anywhere leaves nothing behind.
 *
 * The repositories do not change: outside a transaction the handle behaves
 * exactly like the database it wraps. The transaction in flight is tracked per
 * async call chain (`AsyncLocalStorage`), so concurrent requests never share one.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { NexoraDatabase } from './db.js';

/** Runs `work` so that its writes commit together or not at all. */
export type TransactionRunner = <T>(work: () => Promise<T>) => Promise<T>;

/** A database handle whose queries join the transaction in flight, if any. */
export interface TransactionalDatabase {
  /** Build repositories from this handle. */
  database: NexoraDatabase;
  /** Commits the work's writes together; rolls all of them back when it throws. */
  transaction: TransactionRunner;
}

/** Wraps a database so repositories built from it can take part in a transaction. */
export function createTransactionalDatabase(root: NexoraDatabase): TransactionalDatabase {
  const inFlight = new AsyncLocalStorage<NexoraDatabase>();
  const database = new Proxy(root, {
    get(target, property) {
      const current = inFlight.getStore() ?? target;
      const value = Reflect.get(current, property, current) as unknown;
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(current)
        : value;
    },
  });
  const transaction: TransactionRunner = (work) => {
    // Already inside one: the outer transaction decides the outcome.
    if (inFlight.getStore() !== undefined) return work();
    return root.transaction((tx) => inFlight.run(tx as unknown as NexoraDatabase, work));
  };
  return { database, transaction };
}
