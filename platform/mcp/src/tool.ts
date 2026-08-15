/**
 * @nexora/mcp — Nexora MCP tool contracts.
 *
 * The declarative contract of a Nexora-owned MCP tool. A tool is an
 * ADAPTER over a canonical Agent SDK `Tool` (or any governed execution
 * path) — the definition carries the MCP-facing metadata plus the
 * capability/operation metadata that drives capability-aware discovery and
 * read/write separation. Definitions are never duplicated: the canonical
 * `ToolManifest` stays the source of the name/description/schema, and this
 * contract only adds the MCP namespace, the required capability, and the
 * operation classification (S24 Phase 5: canonical definition → native
 * adapter AND MCP adapter).
 */

import type { NexoraMCPContext } from './context.js';

/** The operation classification of an MCP tool (deterministic, declared). */
export type MCPOperationType = 'read' | 'write';

/** The outcome of a Nexora MCP tool invocation. */
export interface NexoraMCPToolResult {
  /** Whether the invocation succeeded (and was verified, for writes). */
  ok: boolean;
  /** Structured output on success. */
  output?: Record<string, unknown>;
  /** The failure on error, mapped to a Nexora error code. */
  error?: {
    /** A stable Nexora error code (e.g. `UNAUTHORIZED`, `APPROVAL_REQUIRED`). */
    code: string;
    /** A safe, human-readable message (no stack traces, no internals). */
    message: string;
    /** Optional structured detail (e.g. the approval id for a pending gate). */
    details?: Record<string, unknown>;
  };
}

/** The declarative definition of a Nexora MCP tool. */
export interface NexoraMCPToolDefinition {
  /** The stable MCP tool name, namespaced (`nexora.<domain>.<action>`). */
  name: string;
  /** The description surfaced to MCP clients (planner-facing). */
  description: string;
  /** The strict JSON Schema input contract (object; identity/scope never allowed). */
  inputSchema: Record<string, unknown>;
  /**
   * The AI capability id required to see AND invoke this tool (e.g.
   * `projects.list`). Tool discovery filters by this id; a guessed tool
   * outside the caller's capability set is never callable.
   */
  requiredCapability: string;
  /** Read/write classification (writes go through governed execution). */
  operationType: MCPOperationType;
  /** Whether invocation requires human approval (governance metadata). */
  requiresApproval: boolean;
  /** Optional MCP annotations (readOnly/destructive/idempotent hints). */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

/** A registered Nexora MCP tool: definition + invocation handler. */
export interface NexoraMCPTool {
  /** The declarative definition. */
  readonly definition: NexoraMCPToolDefinition;
  /**
   * Invokes the tool under the trusted context. The handler receives ONLY
   * the validated business arguments — identity/scope come from the
   * `context` parameter (never from `args`).
   */
  handle(args: Record<string, unknown>, context: NexoraMCPContext): Promise<NexoraMCPToolResult>;
}
