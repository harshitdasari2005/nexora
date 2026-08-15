/**
 * @nexora/app-api — connector connection store (S25 Phase 7).
 *
 * Binds external connectors to TRUSTED tenant/workspace scope. A connector
 * is only resolvable for the tenant (and workspace, when workspace-scoped)
 * it was configured for — a user from another tenant can never access the
 * connection. Tool execution resolves the connector through this store
 * using the trusted execution context (never from tool arguments), so a
 * foreign tenant/workspace simply has no connector → CONNECTOR_UNAVAILABLE
 * (fail closed).
 *
 * Connections are configured from the environment (GITHUB_TOKEN /
 * SLACK_TOKEN bound to the deployment tenant) for local development;
 * production OAuth/account connections are a later phase. The store is the
 * single resolution seam: the AI Runtime and the MCP surface both resolve
 * connectors here.
 */

import type { ExternalConnector } from '@nexora/connectors';

/**
 * A connection binding: an external connector available to a scope. Ids are
 * plain strings (matching the trusted `ToolExecutionContext`/
 * `ConnectorExecutionContext` id vocabulary).
 */
export interface ConnectorConnection {
  /** The connector implementation. */
  connector: ExternalConnector;
  /** The tenant (organization) that owns the connection. */
  tenantId: string;
  /** An optional workspace scope (tenant-wide when omitted). */
  workspaceId?: string;
}

/**
 * The tenant-scoped connector connection store. Resolution requires the
 * trusted tenant; a workspace-scoped connection additionally requires the
 * trusted workspace. A caller with no matching connection resolves nothing.
 */
export class ConnectorConnectionStore {
  readonly #connections = new Map<string, ConnectorConnection>();

  /** Registers a connection for a tenant (optionally workspace-scoped). */
  register(connection: ConnectorConnection): void {
    const key = this.#key(connection.connector.id, connection.tenantId, connection.workspaceId);
    this.#connections.set(key, connection);
  }

  /**
   * Resolves a connector for the trusted scope. Returns `undefined` when no
   * connection exists for the tenant (or the workspace-scoped binding does
   * not match the trusted workspace) — a foreign tenant/workspace can never
   * reach the provider.
   */
  resolve(
    connectorId: string,
    tenantId: string,
    workspaceId?: string,
  ): ExternalConnector | undefined {
    // Workspace-scoped connection wins; then tenant-wide.
    if (workspaceId !== undefined) {
      const scoped = this.#connections.get(this.#key(connectorId, tenantId, workspaceId));
      if (scoped !== undefined) {
        return scoped.connector;
      }
    }
    const tenantWide = this.#connections.get(this.#key(connectorId, tenantId));
    return tenantWide?.connector;
  }

  /** Whether any connection exists for the trusted scope. */
  has(connectorId: string, tenantId: string, workspaceId?: string): boolean {
    return this.resolve(connectorId, tenantId, workspaceId) !== undefined;
  }

  /** All connectors available to a tenant (for capability enumeration). */
  listFor(tenantId: string, workspaceId?: string): readonly ExternalConnector[] {
    const connectors = new Map<string, ExternalConnector>();
    for (const connection of this.#connections.values()) {
      if (connection.tenantId !== tenantId) {
        continue;
      }
      if (connection.workspaceId !== undefined && connection.workspaceId !== workspaceId) {
        continue;
      }
      connectors.set(connection.connector.id, connection.connector);
    }
    return [...connectors.values()];
  }

  /** All registered connections (for startup wiring). */
  connections(): readonly ConnectorConnection[] {
    return [...this.#connections.values()];
  }

  /** The number of registered connections. */
  get size(): number {
    return this.#connections.size;
  }

  #key(connectorId: string, tenantId: string, workspaceId?: string): string {
    return `${tenantId}\u0000${connectorId}\u0000${workspaceId ?? '*'}`;
  }
}
