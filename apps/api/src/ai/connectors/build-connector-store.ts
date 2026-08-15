/**
 * @nexora/app-api — connector store builder (S25 Phase 7).
 *
 * Builds the tenant-scoped connector connection store from the deployment
 * configuration. Connections are registered ONLY when the connector
 * credential AND the binding tenant are configured — an unconfigured
 * connector is never registered, so the AI/MCP surface never advertises an
 * external capability that cannot execute (fail closed). The connection
 * belongs to exactly one tenant: users of any other tenant resolve no
 * connector and their tool calls fail closed.
 *
 * Credentials live ONLY in the connector's transport (from the environment);
 * they are never accepted through tool arguments and never logged.
 */

import { ConnectorConnectionStore } from './connection-store.js';
import { GitHubConnector } from './github-connector.js';
import { SlackConnector } from './slack-connector.js';

/** Options of {@link buildConnectorStore}. */
export interface BuildConnectorStoreOptions {
  /** GitHub credential (env). Undefined → GitHub is not configured. */
  githubToken?: string;
  /** Slack credential (env). Undefined → Slack is not configured. */
  slackToken?: string;
  /**
   * The tenant that owns the env-configured connections. Required to
   * register any connection — without it nothing is registered.
   */
  tenantId?: string;
}

/**
 * Builds the connection store from configuration. Returns an EMPTY store
 * when no connection can be registered (no credentials or no binding
 * tenant) — callers then expose no external surface.
 */
export function buildConnectorStore(options: BuildConnectorStoreOptions): ConnectorConnectionStore {
  const store = new ConnectorConnectionStore();
  const tenantId = options.tenantId;
  if (tenantId === undefined || tenantId.length === 0) {
    return store;
  }
  if (options.githubToken !== undefined && options.githubToken.length > 0) {
    store.register({
      connector: new GitHubConnector({ token: options.githubToken }),
      tenantId,
    });
  }
  if (options.slackToken !== undefined && options.slackToken.length > 0) {
    store.register({
      connector: new SlackConnector({ token: options.slackToken }),
      tenantId,
    });
  }
  return store;
}
