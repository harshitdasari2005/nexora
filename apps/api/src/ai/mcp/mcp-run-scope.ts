/**
 * @nexora/app-api — per-call MCP run scope (Prompt 7).
 *
 * An MCP session shares ONE correlation id across many tool calls, so the
 * session id cannot identify a single run. Each MCP tool call is its own
 * observed run: the wrapper begins a run under a fresh key and exposes it to
 * the invocation builders through AsyncLocalStorage. The key is used ONLY to
 * file telemetry — it is never an approval, lineage or audit id (those keep
 * using the session correlation id).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage<{ runKey: string }>();

/** Runs `operation` with `runKey` as the ambient MCP telemetry run key. */
export function withMcpRunKey<T>(runKey: string, operation: () => Promise<T>): Promise<T> {
  return scope.run({ runKey }, operation);
}

/** The ambient MCP telemetry run key, as a spreadable `runKey` field (empty outside an observed call). */
export function mcpRunKeyField(): { runKey?: string } {
  const current = scope.getStore();
  return current === undefined ? {} : { runKey: current.runKey };
}
