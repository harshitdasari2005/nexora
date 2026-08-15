/**
 * @nexora/mcp — Nexora MCP server.
 *
 * The Nexora-owned Model Context Protocol server engine (S24 Phase 5 +
 * Phase 6). It wraps the official `@modelcontextprotocol/sdk` `Server` and
 * wires:
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
 * Transport independence (S24 Phase 6): the engine is transport-agnostic.
 * `runStdio()` serves a fixed trusted context over stdio (local,
 * parent-spawned); `handleHttpRequest()` serves the streamable HTTP
 * transport, where EACH MCP session resolves its own trusted context from
 * the authenticated request (the composition layer supplies a
 * `resolveContext` callback invoked ONCE per session — never per tool
 * call). Both transports share the SAME tool registry, capability checks,
 * and governed execution path.
 *
 * The engine is generic (no business logic): the composition layer supplies
 * the tool implementations and the trusted context.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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
  /**
   * The TRUSTED execution context (assembled server-side). Required for
   * single-context operation (stdio); HTTP sessions resolve their own
   * context per session via {@link NexoraMCPServerHandleHttpInput}.
   */
  context?: NexoraMCPContext;
}

/** The server name/version advertised in `initialize`. */
export interface NexoraMCPImplementation {
  name: string;
  version: string;
}

/** The trusted identity of an authenticated HTTP caller (session binding). */
export interface NexoraMCPHandleHttpIdentity {
  /** The authenticated user id (trusted — from the session). */
  userId: string;
  /** The tenant (organization) scope (trusted). */
  tenantId: string;
  /** The membership-validated workspace scope, when selected (trusted). */
  workspaceId?: string;
}

/** Inputs of {@link NexoraMCPServer.handleHttpRequest}. */
export interface NexoraMCPServerHandleHttpInput {
  /**
   * The trusted identity of the authenticated caller, derived server-side
   * (session + membership) — never from tool arguments or MCP payloads.
   * Used to BIND a session to its owner: a later request authenticated as a
   * DIFFERENT user can never reuse (or hijack) an existing session.
   */
  identity: NexoraMCPHandleHttpIdentity;
  /**
   * Resolves the full TRUSTED business context of a NEW session (identity +
   * business domain/role/capability affinity). Invoked ONCE per session —
   * the resolved context is cached for the session's lifetime, so tool
   * calls never re-resolve membership.
   */
  resolveContext: (identity: NexoraMCPHandleHttpIdentity) => Promise<NexoraMCPContext>;
}

/** A live HTTP MCP session (one SDK Server + transport per session). */
interface HttpSession {
  /** The authenticated owner the session is bound to. */
  identity: NexoraMCPHandleHttpIdentity;
  /** The session's TRUSTED context (resolved once at creation). */
  context: NexoraMCPContext;
  /** The SDK protocol server bound to this session's context. */
  sdk: Server;
  /** The streamable-HTTP transport. */
  transport: StreamableHTTPServerTransport;
}

/** Stable HTTP status codes for session-level failures (fail closed). */
export const MCP_HTTP_ERRORS = {
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
} as const;

/**
 * The Nexora MCP server: capability-aware discovery + governed invocation
 * over the standard MCP protocol, over stdio OR authenticated streamable
 * HTTP.
 */
export class NexoraMCPServer {
  readonly #options: NexoraMCPServerOptions;
  readonly #validator = new Ajv({ allErrors: true, strict: false });
  /** stdio mode: the single SDK server bound to the fixed context. */
  readonly #stdio?: Server;
  /** HTTP mode: one SDK Server + transport per MCP session. */
  readonly #sessions = new Map<string, HttpSession>();

  constructor(options: NexoraMCPServerOptions) {
    this.#options = options;
    if (options.context !== undefined) {
      this.#stdio = this.#buildSdkServer(options.context);
    }
  }

  /** The tools visible to the fixed-context caller (stdio / tests). */
  visibleTools(): readonly NexoraMCPTool[] {
    if (this.#options.context === undefined) {
      return [];
    }
    return filterToolsByCapabilities(this.#options.tools, this.#options.context.capabilityIds);
  }

  /**
   * Invokes a tool by MCP name under the fixed trusted context. Re-checks
   * the capability at call time (an unlisted tool is not callable),
   * validates the arguments strictly, and maps the outcome to a structured
   * result.
   */
  async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    output?: unknown;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  }> {
    if (this.#options.context === undefined) {
      return { ok: false, error: { code: 'TOOL_NOT_FOUND', message: `Tool not found: ${name}` } };
    }
    return this.#callWithContext(name, args, this.#options.context);
  }

  /** Connects the server to any standard MCP transport (tests/stdio). */
  async connect(transport: Transport): Promise<void> {
    await this.#requireSdk().connect(transport);
  }

  /** Runs the server over stdio (the local transport). */
  async runStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.#requireSdk().connect(transport);
  }

  /** The advertised implementation (initialize metadata). */
  implementation(): NexoraMCPImplementation {
    return { name: this.#options.name, version: this.#options.version };
  }

  /**
   * Handles an authenticated streamable-HTTP request (GET or POST). Session
   * lifecycle:
   * - A request carrying a KNOWN `mcp-session-id` is routed to its session
   *   transport ONLY when the authenticated identity matches the session's
   *   bound owner (a different user's cookie can never reuse the session).
   * - A request with an UNKNOWN session id gets 404 (the client
   *   re-initializes — sessions are connection-scoped; approvals are the
   *   durable cross-process state, not sessions).
   * - An initialize request (no session id) creates the session: resolves
   *   the trusted context ONCE, builds the SDK server, and connects the
   *   transport.
   *
   * The response is written directly to `res` (callers must hijack their
   * framework reply before delegating).
   */
  async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody: unknown,
    input: NexoraMCPServerHandleHttpInput,
  ): Promise<void> {
    const sessionId = readSessionId(req.headers['mcp-session-id']);

    if (sessionId !== undefined) {
      const session = this.#sessions.get(sessionId);
      if (session === undefined) {
        writeJson(res, MCP_HTTP_ERRORS.notFound, {
          jsonrpc: '2.0',
          error: { code: ErrorCode.InvalidRequest, message: 'Unknown MCP session id' },
        });
        return;
      }
      if (!sameIdentity(session.identity, input.identity)) {
        // Session hijack defense: the session is bound to its owner — a
        // different authenticated identity must never reuse it.
        writeJson(res, MCP_HTTP_ERRORS.forbidden, {
          jsonrpc: '2.0',
          error: { code: ErrorCode.InvalidRequest, message: 'Session belongs to another user' },
        });
        return;
      }
      await session.transport.handleRequest(req, res, parsedBody);
      return;
    }

    // New session (initialize): resolve the trusted context ONCE.
    const context = await input.resolveContext(input.identity);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => `mcp_${sessionToken()}`,
    });
    const sdk = this.#buildSdkServer(context);
    const session: HttpSession = { identity: input.identity, context, sdk, transport };
    transport.onclose = () => {
      if (transport.sessionId !== undefined) {
        this.#sessions.delete(transport.sessionId);
      }
    };
    await sdk.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
    if (transport.sessionId !== undefined) {
      this.#sessions.set(transport.sessionId, session);
    }
  }

  /** The number of live HTTP sessions (observability/tests). */
  httpSessionCount(): number {
    return this.#sessions.size;
  }

  #callWithContext(
    name: string,
    args: Record<string, unknown>,
    context: NexoraMCPContext,
  ): Promise<{
    ok: boolean;
    output?: unknown;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  }> {
    const tool = this.#options.tools.find((candidate) => candidate.definition.name === name);
    if (tool === undefined || !canCallTool(tool, context.capabilityIds)) {
      // A tool outside the caller's affinity is indistinguishable from a
      // nonexistent one — never leak tool existence.
      return Promise.resolve({
        ok: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool not found: ${name}`,
        },
      });
    }

    const valid = this.#validate(tool, args);
    if (!valid.ok) {
      return Promise.resolve({
        ok: false,
        error: { code: 'INVALID_INPUT', message: valid.message },
      });
    }

    return tool.handle(args, context).then((result) => {
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
    });
  }

  /** Builds an SDK protocol server bound to a trusted context. */
  #buildSdkServer(context: NexoraMCPContext): Server {
    const sdk = new Server(
      { name: this.#options.name, version: this.#options.version },
      { capabilities: { tools: {} } },
    );
    sdk.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: filterToolsByCapabilities(this.#options.tools, context.capabilityIds).map((tool) => ({
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

    sdk.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: rawArgs } = request.params;
      const args = (rawArgs ?? {}) as Record<string, unknown>;

      const outcome = await this.#callWithContext(name, args, context);
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
          ? { status: 'approval_required', message: error?.message, ...(error?.details ?? {}) }
          : { status: 'error', code: error?.code, message: error?.message },
        isError: isApprovalRequired ? false : true,
      };
    });
    return sdk;
  }

  #requireContext(): NexoraMCPContext {
    if (this.#options.context === undefined) {
      throw new Error('NexoraMCPServer: a fixed context is required for single-context operation');
    }
    return this.#options.context;
  }

  #requireSdk(): Server {
    if (this.#stdio === undefined) {
      throw new Error('NexoraMCPServer: stdio requires a fixed context');
    }
    return this.#stdio;
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

/** Reads + validates the `Mcp-Session-Id` header value. */
function readSessionId(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/** Whether two trusted identities are the same (session binding check). */
function sameIdentity(a: NexoraMCPHandleHttpIdentity, b: NexoraMCPHandleHttpIdentity): boolean {
  return (
    a.userId === b.userId &&
    a.tenantId === b.tenantId &&
    (a.workspaceId ?? '') === (b.workspaceId ?? '')
  );
}

/** Writes a JSON error body to a raw HTTP response (no internals leaked). */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** A short opaque session token (cryptographic, URL-safe). */
function sessionToken(): string {
  return createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 24);
}
