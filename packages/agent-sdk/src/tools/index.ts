/**
 * @nexora/agent-sdk — tools.
 *
 * Tools are the only way agents touch the world (AIR.md §10). The SDK
 * defines the generic `Tool` contract; the canonical manifest shapes
 * (`ToolContract`, `AgentTool`) come from `@nexora/contracts/ai`.
 */

import type { AgentTool, ToolContract } from '@nexora/contracts/ai';
import type { ToolId } from '../types/index.js';

/** A tool manifest: the declarative contract of a tool (AIR.md §5). */
export interface ToolManifest {
  /** Tool id. */
  id: ToolId;
  /** Human-readable name. */
  name: string;
  /** Description for the planner. */
  description: string;
  /** Side-effect class driving approval routing (PSD.md §9.3). */
  sideEffectClass: AgentTool['sideEffectClass'];
  /** Whether the tool is idempotent-safe to re-invoke (AIR.md §10.7). */
  idempotent: boolean;
  /** Timeout budget, in milliseconds. */
  timeoutMs: number;
  /** Input schema (JSON Schema). */
  inputSchema: Record<string, unknown>;
}

/**
 * The execution view passed to a tool. Every field is **trusted server-side
 * context** — assembled by the runtime from the authenticated session.
 * Tools must NEVER accept identity, tenant, or authorization scope from the
 * model/prompt/tool arguments: the model may request an *action*, but it may
 * not define *who* acts or *where* (AIR.md §7, security contract).
 */
export interface ToolExecutionContext {
  /** The authenticated user id (trusted; never model-derived). */
  userId: string;
  /** Tenant (organization) scope (trusted). */
  tenantId: string;
  /** Workspace scope, when workspace-scoped (trusted). */
  workspaceId?: string;
  /** Correlation/execution id for tracing. */
  executionId: string;
}

/** The result of a tool invocation. */
export interface ToolResult<TOutput = unknown> {
  /** Whether the invocation succeeded. */
  ok: boolean;
  /** Output on success. */
  output?: TOutput;
  /** Error message on failure. */
  error?: string;
  /** ISO-8601 UTC time the invocation completed. */
  completedAt: string;
}

/** A tool the agent may invoke. */
export interface Tool<TInput = Record<string, unknown>, TOutput = unknown> {
  /** The tool manifest. */
  readonly manifest: ToolManifest;
  /** Invokes the tool. */
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}

/** Metadata attached to a registered tool. */
export interface ToolMetadata {
  /** Tool id. */
  id: ToolId;
  /** ISO-8601 UTC time the tool was registered. */
  registeredAt: string;
  /** Number of invocations so far. */
  invocationCount: number;
}

/** A registry entry for a registered tool. */
export interface ToolDescriptor {
  /** The tool manifest. */
  manifest: ToolManifest;
  /** Registration metadata. */
  metadata: ToolMetadata;
}

/**
 * The tool registry: registers and resolves tools by id (AIR.md §5 tool
 * registry). Backed by an in-memory map; thread-safety is the owner's
 * concern at the platform boundary.
 */
export class ToolRegistry {
  readonly #tools = new Map<string, Tool<unknown, unknown>>();
  readonly #metadata = new Map<string, ToolMetadata>();

  /** Registers a tool. Throws on duplicate ids. */
  register(tool: Tool<unknown, unknown>): void {
    if (this.#tools.has(tool.manifest.id)) {
      throw new Error(`Tool already registered: ${tool.manifest.id}`);
    }
    this.#tools.set(tool.manifest.id, tool);
    this.#metadata.set(tool.manifest.id, {
      id: tool.manifest.id,
      registeredAt: new Date().toISOString(),
      invocationCount: 0,
    });
  }

  /** Returns the registered tool, or `undefined`. */
  resolve(id: string): Tool<unknown, unknown> | undefined {
    return this.#tools.get(id);
  }

  /** Returns the tool descriptor, or `undefined`. */
  describe(id: string): ToolDescriptor | undefined {
    const manifest = this.#tools.get(id)?.manifest;
    const metadata = this.#metadata.get(id);
    if (manifest === undefined || metadata === undefined) {
      return undefined;
    }
    return { manifest, metadata };
  }

  /** Records an invocation for metrics. */
  recordInvocation(id: string): void {
    const metadata = this.#metadata.get(id);
    if (metadata !== undefined) {
      this.#metadata.set(id, { ...metadata, invocationCount: metadata.invocationCount + 1 });
    }
  }

  /** All registered tool ids. */
  ids(): readonly string[] {
    return [...this.#tools.keys()];
  }

  /** The number of registered tools. */
  get size(): number {
    return this.#tools.size;
  }

  /** Converts every registered tool to its canonical contract shape. */
  toContracts(): readonly ToolContract[] {
    return [...this.#tools.values()].map((tool) => ({
      id: tool.manifest.id,
      description: tool.manifest.description,
      sideEffectClass: tool.manifest.sideEffectClass,
      idempotent: tool.manifest.idempotent,
      timeoutMs: tool.manifest.timeoutMs,
      inputSchema: tool.manifest.inputSchema,
    }));
  }
}
