/**
 * @nexora/ai-runtime — mock tools.
 *
 * Test tools (Agent SDK `Tool` contract) and a recording mock tool executor.
 */

import type { Tool, ToolResult } from '@nexora/agent-sdk/tools';
import type { SideEffectClass } from '@nexora/contracts/ai';
import { nowIso } from '@nexora/shared/time';
import type { ToolExecutionResult, ToolInvocation } from '../execution/tool-executor.js';

/** Builds a tool manifest for a mock tool. */
export function mockToolManifest(input: {
  id: string;
  sideEffectClass?: SideEffectClass;
  idempotent?: boolean;
  timeoutMs?: number;
  description?: string;
}) {
  return {
    id: input.id,
    name: input.id,
    description: input.description ?? `Tool ${input.id}`,
    sideEffectClass: input.sideEffectClass ?? 'read_only',
    idempotent: input.idempotent ?? false,
    timeoutMs: input.timeoutMs ?? 1_000,
    inputSchema: {},
  };
}

/** A mock tool with a scripted handler. */
export class MockTool implements Tool {
  readonly manifest;
  /** Invocations received. */
  invocations: Record<string, unknown>[] = [];
  /** The result to return. */
  result: ToolResult<unknown> = { ok: true, output: { done: true }, completedAt: nowIso() };
  /** Throws the given error on the next invocation, when set. */
  throwError?: Error;

  constructor(manifest: ReturnType<typeof mockToolManifest>) {
    this.manifest = manifest;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult<unknown>> {
    this.invocations.push(input);
    if (this.throwError !== undefined) {
      throw this.throwError;
    }
    return this.result;
  }
}

/** A recording mock tool executor (implements the executor's call surface). */
export class MockToolExecutor {
  /** Executions requested, in order. */
  executions: ToolInvocation[] = [];
  /** The result to return. */
  result: ToolExecutionResult = {
    ok: true,
    toolId: 'mock',
    output: { done: true },
    attempts: 1,
    verified: true,
    blocked: false,
    completedAt: nowIso(),
  };

  async execute(
    invocation: ToolInvocation,
    _approvalGranted = false,
  ): Promise<ToolExecutionResult> {
    this.executions.push(invocation);
    return { ...this.result, toolId: invocation.toolId };
  }
}
