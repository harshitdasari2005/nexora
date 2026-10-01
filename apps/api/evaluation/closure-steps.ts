/**
 * @nexora/app-api — contrived closure steps (dataset closure scenarios,
 * NXS-193 … NXS-204).
 *
 * Two lifecycle steps that reach a real platform seam no composed entry point
 * reaches on its own, because the layers in front of it always refuse first:
 *
 *  - `start_workflow`: starts a registered workflow definition through the
 *    app's real `WorkflowApplicationService` (the handler `POST /api/workflows`
 *    calls) with a narrower instance ceiling than any entry point would bind —
 *    the entry points run the initiator's up-front check, so a started
 *    instance never lacks an inner capability. It proves the ceiling BOUND TO
 *    a started instance still refuses an inner step outside it.
 *  - `invoke_tool`: invokes one tool through a `ToolExecutor` composed exactly
 *    like the MCP server's (the app's real registry, policy, lineage and
 *    security sink) with an explicit ceiling mode (`absent` / `[]` / listed).
 *    Discovery, MCP visibility and the workflow adapter never hand the executor
 *    an EMPTY ceiling, so this is the only way to assert the executor's own
 *    last line of defense.
 *
 * Both are documented as contrived in the evaluation README. Neither weakens a
 * production check: they only choose the INPUT of the real component under test.
 */

import { ToolExecutor } from '@nexora/ai-runtime/execution';
import { StartWorkflowHandler } from '@nexora/module-workflow';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { ScenarioDefinition } from '@nexora/evaluation';

import type { StepOutcome } from './governance-checks.js';
import type { ScenarioApp } from './harness.js';

type LifecycleStep = NonNullable<
  Extract<ScenarioDefinition['request'], { channel: 'agent' }>['afterGate']
>[number];

/** Runs `start_workflow`; the outcome is 201 when the instance started, else 400. */
export async function runStartWorkflow(
  harness: ScenarioApp,
  step: Extract<LifecycleStep, { kind: 'start_workflow' }>,
): Promise<StepOutcome> {
  const world = harness.world;
  const handler = new StartWorkflowHandler(harness.runtime.workflows);
  const result = await handler.handle({
    definitionKey: step.definitionKey,
    context: {
      userId: world.user(step.actor).id,
      tenantId: world.organization(step.organization).id as TenantId,
      ...(step.workspace === undefined
        ? {}
        : { workspaceId: world.workspace(step.workspace).id as WorkspaceId }),
      correlationId: `eval_closure_${step.label}`,
      // A direct operator start (no agent, no approval record), like `POST /api/workflows`.
      origin: 'rest',
      allowedCapabilityIds: step.ceiling,
    },
    input: step.input,
  });
  if (!result.ok) {
    return {
      status: 400,
      errorCode: 'WORKFLOW_NOT_STARTED',
      body: JSON.stringify({ error: result.error.message }),
    };
  }
  return {
    status: 201,
    body: JSON.stringify({
      status: result.value.instance.status,
      steps: result.value.steps.map((s) => ({ stepId: s.stepId, status: s.status })),
    }),
  };
}

/** Runs `invoke_tool`; the outcome is 200 when the tool executed, 403 when the executor refused. */
export async function runInvokeTool(
  harness: ScenarioApp,
  step: Extract<LifecycleStep, { kind: 'invoke_tool' }>,
): Promise<StepOutcome> {
  const world = harness.world;
  const runtime = harness.runtime;
  const executor = new ToolExecutor({
    tools: runtime.tools,
    securitySink: runtime.securitySink,
    ...(runtime.policy === undefined ? {} : { policy: runtime.policy }),
    ...(runtime.lineage === undefined ? {} : { lineage: runtime.lineage }),
    ...(runtime.agentAuthority === undefined ? {} : { agentAuthority: runtime.agentAuthority }),
  });
  const result = await executor.execute(
    {
      toolId: step.tool,
      capabilityId: step.tool,
      input: step.input,
      userId: world.user(step.actor).id,
      tenantId: world.organization(step.organization).id,
      workspaceId: world.workspace(step.workspace).id,
      runId: `run_closure_${step.label}`,
      autonomyTier: 'supervised',
      origin: 'orchestrator',
      ...(step.ceiling === 'absent' ? {} : { allowedCapabilityIds: step.ceiling }),
    },
    // The approval a governed run would already hold: the ceiling check under
    // test comes BEFORE the approval gate, and a permitted call must run.
    true,
  );
  return result.ok
    ? { status: 200, body: JSON.stringify({ ok: true }) }
    : {
        status: 403,
        ...(result.error === undefined ? {} : { errorCode: result.error.code }),
        body: JSON.stringify({ ok: false, error: result.error }),
      };
}
