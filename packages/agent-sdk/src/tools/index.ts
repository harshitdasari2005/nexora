/**
 * @nexora/agent-sdk — tools.
 *
 * Tools are the only way agents touch the world (AIR.md §10). The SDK
 * defines the generic `Tool` contract; the canonical manifest shapes
 * (`ToolContract`, `AgentTool`) come from `@nexora/contracts/ai`.
 */

import type { AgentTool, ToolContract } from '@nexora/contracts/ai';
import type { ToolId } from '../types/index.js';

/**
 * How a tool's success is independently confirmed (Prompt 9, G4). A tool
 * DECLARES its source; the runtime never upgrades it:
 * - `state_readback`: re-reads the changed application state.
 * - `provider_readback`: re-reads the external provider's state.
 * - `response_shape`: only validates the shape of the response.
 * - `handler_result`: the handler reported success; nothing independent.
 * - `redetection`: re-runs the detection that raised the problem.
 */
export type ToolVerificationSource =
  'state_readback' | 'provider_readback' | 'response_shape' | 'handler_result' | 'redetection';

/** Declared verification metadata of a tool. */
export interface ToolVerificationMetadata {
  /** How success is confirmed. Only tools that truly read back may declare a readback source. */
  source: ToolVerificationSource;
  /** What the verification does NOT prove (shown to reviewers). */
  limitation?: string;
}

/**
 * The verification a tool is assumed to have when it declares none: the
 * handler's own report — no independent state read-back.
 */
export const DEFAULT_TOOL_VERIFICATION: Readonly<ToolVerificationMetadata> = Object.freeze({
  source: 'handler_result',
  limitation: 'the tool reported success; no independent state read-back',
});

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
  /**
   * How the tool's success is verified (Prompt 9). Optional: when absent the
   * runtime records {@link DEFAULT_TOOL_VERIFICATION} (`handler_result`).
   */
  verification?: ToolVerificationMetadata;
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
  /**
   * The TRUSTED agent principal the invocation runs as (Prompt 4), when it
   * runs as an agent. Set only by the executor from server-resolved state.
   */
  agent?: { agentId: string; definitionId: string; name: string };
  /** The delegation that authorized an agent invocation. */
  delegationId?: string;
  /** The approval the invocation executes under, when resuming one. */
  approvalId?: string;
  /** The entry point that issued the invocation (orchestrator, mcp, workflow, …). */
  origin?: string;
  /**
   * The invoking run's RBAC capability ceiling (trusted, server-derived).
   * Composite tools (workflows) bound their inner steps by it so a nested
   * capability can never exceed what the initiator's run was allowed.
   */
  allowedCapabilityIds?: readonly string[];
}

/** The result of a tool invocation. */
export interface ToolResult<TOutput = unknown> {
  /** Whether the invocation succeeded. */
  ok: boolean;
  /** Output on success. */
  output?: TOutput;
  /** Error message on failure. */
  error?: string;
  /**
   * Set by a tool whose OWN read-back verification ran and DISAGREED with its
   * handler (Prompt 9): the invocation is reported failed AND carries the
   * tool's declared verification source (`verified: false`). An ordinary
   * failure (validation, authorization, handler error) never sets it and so
   * carries no verification claim at all.
   */
  readBackFailed?: boolean;
  /**
   * A user-presentable statement, vetted by the tool, of what a FAILED
   * invocation did or left behind — e.g. a workflow's rollback outcome
   * ("Rolled back: Hire employee"). Unlike {@link error} (which the
   * platform treats as possibly internal and never shows verbatim), a
   * `detail` is written by the tool to be safe to show: no ids, inputs, or
   * stack traces. Absent when there is nothing to add.
   */
  detail?: string;
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
