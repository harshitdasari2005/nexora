/**
 * @nexora/connectors — connector registry.
 *
 * The extensible registry of external connectors (S25 Phase 7): providers
 * register their connector implementation once, and every other layer
 * (AI capability discovery, MCP tool surface, governance) resolves through
 * this registry — adding a new connector requires 1) an implementation of
 * the {@link ExternalConnector} contract, 2) its capability/tool
 * declarations, and 3) a registration call. NO changes across the AI
 * Runtime or the MCP engine.
 *
 * The registry is credential-agnostic: connectors carry their connection
 * configuration internally. Tenant/workspace scoping of connections is the
 * caller's concern at the platform boundary (the apps layer binds a
 * connector to trusted membership exactly like every other resource).
 */

import type { ConnectorTool, ExternalConnector } from './connector.js';

/** A resolved connector tool: the tool plus its owning connector. */
export interface ResolvedConnectorTool {
  /** The owning connector. */
  connector: ExternalConnector;
  /** The tool definition. */
  tool: ConnectorTool;
}

/**
 * The connector registry: registers and resolves connectors by id,
 * capability, and tool. Backed by an in-memory map; thread-safety is the
 * owner's concern at the platform boundary.
 */
export class ConnectorRegistry {
  readonly #connectors = new Map<string, ExternalConnector>();

  /** Registers a connector. Throws on duplicate ids. */
  register(connector: ExternalConnector): void {
    if (this.#connectors.has(connector.id)) {
      throw new Error(`Connector already registered: ${connector.id}`);
    }
    this.#connectors.set(connector.id, connector);
  }

  /** Returns the registered connector, or `undefined`. */
  get(id: string): ExternalConnector | undefined {
    return this.#connectors.get(id);
  }

  /** All registered connectors. */
  list(): readonly ExternalConnector[] {
    return [...this.#connectors.values()];
  }

  /** Whether a connector id is registered. */
  has(id: string): boolean {
    return this.#connectors.has(id);
  }

  /**
   * Resolves the first connector that serves a capability id, plus the
   * tool that requires it. Returns `undefined` when no connector serves the
   * capability (or when the capability is unknown).
   */
  resolveCapability(capabilityId: string): ResolvedConnectorTool | undefined {
    for (const connector of this.#connectors.values()) {
      const tool = connector.tools.find((t) => t.requiredCapability === capabilityId);
      if (tool !== undefined) {
        return { connector, tool };
      }
    }
    return undefined;
  }

  /**
   * Resolves a connector tool by its stable id. Returns `undefined` when no
   * connector registers that tool (an unavailable tool is indistinguishable
   * from a nonexistent one — no capability leak).
   */
  resolveTool(toolId: string): ResolvedConnectorTool | undefined {
    for (const connector of this.#connectors.values()) {
      const tool = connector.resolveTool(toolId);
      if (tool !== undefined) {
        return { connector, tool };
      }
    }
    return undefined;
  }

  /** All tools across all registered connectors. */
  tools(): readonly ConnectorTool[] {
    return [...this.#connectors.values()].flatMap((connector) => connector.tools);
  }

  /** All capability ids served by the registered connectors. */
  capabilityIds(): readonly string[] {
    return [...this.#connectors.values()].flatMap((connector) => connector.capabilities);
  }

  /** The number of registered connectors. */
  get size(): number {
    return this.#connectors.size;
  }
}
