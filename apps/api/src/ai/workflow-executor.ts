/**
 * @nexora/app-api — workflow step executor adapter.
 *
 * Wires the workflow module's {@link WorkflowStepExecutor} port to the AI
 * Runtime's {@link ToolExecutor}: workflow steps execute through the EXACT
 * same governed pipeline as AI tool calls (resolve → validate → side-effect
 * guard → invoke → verify) — one execution path, no bypass. The adapter is
 * pure plumbing: it maps the workflow invocation to a tool invocation and
 * translates the executor's result, including the tool's idempotency flag
 * (the engine's retry-safety signal, read from the canonical tool manifest
 * in the executable registry — never inferred or caller-supplied).
 */

import type { ToolExecutor, ToolInvocation } from '@nexora/ai-runtime/execution';
import type { ExecutableToolRegistry } from '@nexora/ai-runtime/registry';
import type {
  WorkflowStepExecutor,
  WorkflowStepInvocation,
  WorkflowStepResult,
} from '@nexora/module-workflow';

/** Adapter from the AI tool executor to the workflow step executor port. */
export class WorkflowToolStepExecutor implements WorkflowStepExecutor {
  readonly #executor: ToolExecutor;
  readonly #tools: ExecutableToolRegistry;

  constructor(executor: ToolExecutor, tools: ExecutableToolRegistry) {
    this.#executor = executor;
    this.#tools = tools;
  }

  async execute(invocation: WorkflowStepInvocation): Promise<WorkflowStepResult> {
    const toolInvocation: ToolInvocation = {
      toolId: invocation.toolId,
      input: invocation.input,
      userId: invocation.context.userId,
      tenantId: invocation.context.tenantId,
      workspaceId: invocation.context.workspaceId,
      runId: invocation.context.runId,
      autonomyTier: invocation.context.autonomyTier,
    };
    const result = await this.#executor.execute(toolInvocation, invocation.approvalGranted);

    const tool = this.#tools.resolve(invocation.toolId);
    const manifest = tool?.manifest;

    return {
      ok: result.ok,
      output: result.output,
      error: result.error,
      blocked: result.blocked,
      verified: result.verified,
      sideEffectClass:
        manifest?.sideEffectClass ?? ('consequential' as WorkflowStepResult['sideEffectClass']),
      attempts: result.attempts,
      // Retry-safety comes from the tool contract: only idempotent tools may
      // be retried by the workflow engine (a retry could otherwise duplicate
      // a business mutation).
      retryable: manifest?.idempotent === true,
    };
  }
}
