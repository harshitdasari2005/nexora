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

/** A capability id no tool matches: an instance with no ceiling permits nothing. */
const NO_CAPABILITY_PERMITTED = '__workflow.no_capability_permitted__';

/** Adapter from the AI tool executor to the workflow step executor port. */
export class WorkflowToolStepExecutor implements WorkflowStepExecutor {
  readonly #executor: ToolExecutor;
  readonly #tools: ExecutableToolRegistry;

  constructor(executor: ToolExecutor, tools: ExecutableToolRegistry) {
    this.#executor = executor;
    this.#tools = tools;
  }

  async execute(invocation: WorkflowStepInvocation): Promise<WorkflowStepResult> {
    const { context } = invocation;
    // RBAC ceiling of the INITIATING run, applied to every inner step and
    // compensation. Fail closed: an instance with no ceiling permits nothing
    // (the executor treats an empty ceiling as "unrestricted", so a sentinel
    // that matches no capability is used). A compensation runs only when the
    // forward capability it undoes was permitted — the compensating tool is
    // workflow-internal and holds no capability of its own.
    const ceiling = context.allowedCapabilityIds ?? [];
    const compensationPermitted =
      invocation.purpose === 'compensation' &&
      invocation.compensatesCapabilityId !== undefined &&
      ceiling.includes(invocation.compensatesCapabilityId);
    const bounded: readonly string[] = compensationPermitted
      ? [...ceiling, invocation.capabilityId]
      : ceiling;
    const allowedCapabilityIds = bounded.length === 0 ? [NO_CAPABILITY_PERMITTED] : bounded;

    const toolInvocation: ToolInvocation = {
      toolId: invocation.toolId,
      // The capability the step is bound to (RBAC ceiling + policy vocabulary).
      capabilityId: invocation.capabilityId,
      input: invocation.input,
      // Trusted scope comes ONLY from the instance context, never from input.
      userId: context.userId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      runId: context.runId,
      autonomyTier: context.autonomyTier,
      allowedCapabilityIds,
      origin: 'workflow',
      // Attribution for lineage/audit: the initiating actor is `userId`; the
      // agent principal / delegation / approval it ran under ride along. NO
      // `agent` is set — per-step delegation checks are deliberately not
      // re-run (workflow-level authorization + approval covers the unit;
      // the ceiling above bounds it).
      ...(context.approvalId === undefined ? {} : { approvalId: context.approvalId }),
      ...(context.agentId === undefined
        ? {}
        : {
            attribution: {
              agent: { agentId: context.agentId, definitionId: '', name: '' },
              ...(context.delegationId === undefined ? {} : { delegationId: context.delegationId }),
            },
          }),
      ...(invocation.approvalBasis === undefined
        ? {}
        : { approvalBasis: invocation.approvalBasis }),
      // Step lineage: which step ran, and whether it was a forward step or a compensation.
      lineage: { workflow: { stepId: invocation.stepId, purpose: invocation.purpose ?? 'step' } },
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
