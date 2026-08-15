/**
 * @nexora/mcp — Nexora MCP server.
 *
 * The Nexora-owned Model Context Protocol server engine (S24 Phase 5). It
 * wraps the official `@modelcontextprotocol/sdk` `Server` and wires:
 *
 * - `tools/list` — capability-aware: only the tools whose required
 *   capability is in the caller's TRUSTED capability affinity are listed.
 * - `tools/call` — resolves the tool, RE-CHECKS the capability at call time
 *   (a guessed tool name outside the affinity is indistinguishable from a
 *   nonexistent one), validates the arguments against the strict input
 *   schema, and invokes the tool's governed handler under the trusted
 *   context. Tool-level failures return structured results (`isError` +
 *   stable Nexora codes); protocol-level failures return MCP JSON-RPC
 *   errors.
 *
 * The engine is generic (no business logic): the composition layer supplies
 * the tool implementations and the trusted context. Stdio is the Phase 5
 * transport — a local, parent-spawned process whose identity is established
 * out-of-band (env), never from tool arguments.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Ajv } from 'ajv';

import type { NexoraMCPContext } from './context.js';
import { canCallTool, filterToolsByCapabilities } from './discovery.js';
import type { NexoraMCPTool } from './tool.js';

/** Options for the {@link NexoraMCPServer}. */
export interface NexoraMCPServerOptions {
  /** The server name advertised in `initialize`. */
  name: string;
  /** The server version advertised in `initialize`. */
  version: string;
  /** The registered Nexora MCP tools (the full surface). */
  tools: readonly NexoraMCPTool[];
  /** The TRUSTED execution context (assembled server-side). */
  context: NexoraMCPContext;
}

/** The server name/version advertised in `initialize`. */
export interface NexoraMCPImplementation {
  name: string;
  version: string;
}

/**
 * The Nexora MCP server: capability-aware discovery + governed invocation
 * over the standard MCP protocol.
 */
export class NexoraMCPServer {
  readonly #options: NexoraMCPServerOptions;
  readonly #validator = new Ajv({ allErrors: true, strict: false });
  readonly #sdk: Server;

  constructor(options: NexoraMCPServerOptions) {
    this.#options = options;
    this.#sdk = new Server(
      { name: options.name, version: options.version },
      { capabilities: { tools: {} } },
    );
    this.#wireHandlers();
  }

  /** The tools visible to the caller (capability-filtered). */
  visibleTools(): readonly NexoraMCPTool[] {
    return filterToolsByCapabilities(this.#options.tools, this.#options.context.capabilityIds);
  }

  /**
   * Invokes a tool by MCP name under the trusted context. Re-checks the
   * capability at call time (an unlisted tool is not callable), validates
   * the arguments strictly, and maps the outcome to a structured result.
   */
  async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    output?: unknown;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  }> {
    const tool = this.#options.tools.find((candidate) => candidate.definition.name === name);
    if (tool === undefined || !canCallTool(tool, this.#options.context.capabilityIds)) {
      // A tool outside the caller's affinity is indistinguishable from a
      // nonexistent one — never leak tool existence.
      return {
        ok: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool not found: ${name}`,
        },
      };
    }

    const valid = this.#validate(tool, args);
    if (!valid.ok) {
      return {
        ok: false,
        error: { code: 'INVALID_INPUT', message: valid.message },
      };
    }

    const result = await tool.handle(args, this.#options.context);
    if (result.ok) {
      return { ok: true, output: result.output };
    }
    return {
      ok: false,
      error: {
        code: result.error?.code ?? 'EXECUTION_FAILED',
        message: result.error?.message ?? 'The tool call failed',
        ...(result.error?.details === undefined ? {} : { details: result.error.details }),
      },
    };
  }

  /** Connects the server to any standard MCP transport (stdio in Phase 5). */
  async connect(transport: Transport): Promise<void> {
    await this.#sdk.connect(transport);
  }

  /** Runs the server over stdio (the Phase 5 local transport). */
  async runStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.#sdk.connect(transport);
  }

  /** The advertised implementation (initialize metadata). */
  implementation(): NexoraMCPImplementation {
    return { name: this.#options.name, version: this.#options.version };
  }

  #wireHandlers(): void {
    this.#sdk.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.visibleTools().map((tool) => ({
        name: tool.definition.name,
        description: tool.definition.description,
        inputSchema: tool.definition.inputSchema as {
          type: 'object';
          properties?: Record<string, unknown>;
          required?: string[];
        },
        annotations: tool.definition.annotations,
      })),
    }));

    this.#sdk.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: rawArgs } = request.params;
      const args = (rawArgs ?? {}) as Record<string, unknown>;

      const outcome = await this.call(name, args);
      if (outcome.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: outcome.output === undefined ? 'OK' : JSON.stringify(outcome.output, null, 2),
            },
          ],
          structuredContent: outcome.output,
        };
      }

      // Tool-level failure: a structured result with isError (per the MCP
      // spec, tool errors are results so clients can self-correct). An
      // approval-required outcome is a governance state, not an error — it
      // returns a success-shaped result with a clear status.
      const error = outcome.error;
      const isApprovalRequired = error?.code === 'APPROVAL_REQUIRED';
      return {
        content: [
          {
            type: 'text' as const,
            text: isApprovalRequired
              ? `Approval required: ${error?.message ?? ''}`
              : (error?.message ?? 'The tool call failed'),
          },
        ],
        structuredContent: isApprovalRequired
          ? { status: 'approval_required', message: error?.message }
          : { status: 'error', code: error?.code, message: error?.message },
        isError: isApprovalRequired ? false : true,
      };
    });
  }

  #validate(
    tool: NexoraMCPTool,
    args: Record<string, unknown>,
  ): { ok: true } | { ok: false; message: string } {
    try {
      const validate = this.#validator.compile(tool.definition.inputSchema);
      const valid = validate(args);
      if (valid) {
        return { ok: true };
      }
      const detail = (validate.errors ?? [])
        .slice(0, 5)
        .map((issue) => `${issue.instancePath || '<root>'}: ${issue.message ?? 'invalid'}`)
        .join('; ');
      return {
        ok: false,
        message: `Invalid arguments for ${tool.definition.name}: ${detail}`,
      };
    } catch {
      // A malformed schema must never crash the request — fail closed.
      return { ok: false, message: `Invalid arguments for ${tool.definition.name}` };
    }
  }
}

/** Error codes mapped to MCP protocol errors (exposed for callers/tests). */
export const MCP_PROTOCOL_ERRORS = {
  toolNotFound: () => new McpError(ErrorCode.MethodNotFound, 'Tool not found'),
  invalidParams: (message: string) => new McpError(ErrorCode.InvalidParams, message),
  internal: (message: string) => new McpError(ErrorCode.InternalError, message),
};
