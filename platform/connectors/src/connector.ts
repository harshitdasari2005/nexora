/**
 * @nexora/connectors — external connector contract.
 *
 * The generic contract every external business-system connector implements
 * (S25 Phase 7). A connector is an ADAPTER to an external provider
 * (GitHub, Slack, and future systems) that:
 *
 * - declares the Nexora business capabilities it serves (e.g.
 *   `github.issues.create`) — the SAME capability vocabulary the Phase 1
 *   catalog and the AI/MCP capability bridge use (one capability model);
 * - exposes a small set of tools, each with a strict typed input schema
 *   (identity/tenant/workspace/credentials are NEVER part of tool input —
 *   they come from the trusted execution context);
 * - executes provider calls ONLY through the injected HTTP transport
 *   (credentials live in the connector's connection, never in tool args).
 *
 * Governance is NOT the connector's job: the apps layer routes every
 * connector operation through the existing authorization, approval,
 * verification, and audit seams. A connector is never a privilege-escalation
 * mechanism — it serves whatever the trusted context allows.
 */

import type { ConnectorError } from './errors.js';

/** The operation classification of a connector tool (deterministic). */
export type ConnectorOperationType = 'read' | 'write';

/** The trusted execution context of a connector operation. */
export interface ConnectorExecutionContext {
  /** The trusted tenant (organization) scope. */
  tenantId: string;
  /** The trusted workspace scope, when workspace-scoped. */
  workspaceId?: string;
  /** Correlation id for tracing + approval correlation. */
  correlationId: string;
}

/** The outcome of a connector tool invocation. */
export interface ConnectorToolResult {
  /** Whether the invocation succeeded (and was verified, for writes). */
  ok: boolean;
  /** Structured output on success. */
  output?: Record<string, unknown>;
  /** The stable connector error on failure. */
  error?: ConnectorError;
}

/** A connector tool: definition + provider execution. */
export interface ConnectorTool {
  /** The stable tool id, namespaced by provider (`github.issues.list`). */
  id: string;
  /** The human-readable name. */
  name: string;
  /** The description (planner-facing). */
  description: string;
  /** The strict JSON Schema input contract (no identity/scope/credentials). */
  inputSchema: Record<string, unknown>;
  /** The Nexora capability id this tool requires (e.g. `github.issues.list`). */
  requiredCapability: string;
  /** Read/write classification (writes go through governed execution). */
  operationType: ConnectorOperationType;
  /** Whether the operation requires human approval (governance metadata). */
  requiresApproval: boolean;
  /** The provider timeout budget in milliseconds. */
  timeoutMs: number;
  /** Executes the tool under the trusted context. */
  execute(
    input: Record<string, unknown>,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorToolResult>;
}

/**
 * An external business-system connector: the implementation of the generic
 * contract. Providers register themselves with a {@link ConnectorRegistry}
 * (id + capability + tool resolution) — the AI Runtime never references a
 * specific provider.
 */
export interface ExternalConnector {
  /** The stable connector id (`github`, `slack`). */
  id: string;
  /** The display name (`GitHub`). */
  name: string;
  /** The provider key (`github`) — used in audit/error attribution. */
  provider: string;
  /** The Nexora business capabilities this connector serves. */
  capabilities: readonly string[];
  /** The connector's tools. */
  tools: readonly ConnectorTool[];
  /** Resolves a tool by id, or `undefined`. */
  resolveTool(toolId: string): ConnectorTool | undefined;
}
