/**
 * Workflow governance — the initiating run's RBAC ceiling and attribution
 * are threaded into EVERY inner step and compensation invocation.
 *
 * The engine only carries the trusted values (scope from the instance, the
 * ceiling, the initiating actor + agent/delegation/approval attribution, and
 * the approval basis); enforcement is the executor adapter's job (proved
 * end-to-end in apps/api `workflow-governance.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import {
  WorkflowDefinitionRegistry,
  hireAndAssignEmployeeWorkflowDefinition,
} from '../src/domain/workflow-definition.js';
import { WorkflowInstance } from '../src/domain/workflow-instance.js';
import type {
  WorkflowStepExecutor,
  WorkflowStepInvocation,
  WorkflowStepResult,
} from '../src/runtime/workflow-executor.js';
import { WorkflowRuntime } from '../src/runtime/workflow-runtime.js';
import {
  InMemoryWorkflowInstanceRepository,
  InMemoryWorkflowStepExecutionRepository,
  RecordingEventPublisher,
  failResult,
  okResult,
  testContext,
} from './helpers.js';

/** Records every full invocation; fails the tools named in `failTools`. */
class RecordingExecutor implements WorkflowStepExecutor {
  readonly invocations: WorkflowStepInvocation[] = [];
  constructor(private readonly failTools: ReadonlySet<string> = new Set()) {}
  async execute(invocation: WorkflowStepInvocation): Promise<WorkflowStepResult> {
    this.invocations.push(invocation);
    if (this.failTools.has(invocation.toolId)) {
      return failResult('refused');
    }
    return okResult({ employee: { id: 'emp_0a1b2c3d-0000-4000-8000-000000000001' } });
  }
}

function rig(failTools: string[] = []) {
  const executor = new RecordingExecutor(new Set(failTools));
  const instances = new InMemoryWorkflowInstanceRepository();
  const runtime = new WorkflowRuntime({
    definitions: new WorkflowDefinitionRegistry([hireAndAssignEmployeeWorkflowDefinition()]),
    instances,
    executions: new InMemoryWorkflowStepExecutionRepository(),
    executor,
    publisher: new RecordingEventPublisher(),
  });
  return { runtime, executor, instances };
}

const INPUT = { employeeName: 'Rohan Das', projectName: 'Quantum Ledger' };
const CEILING = ['hr.create_employee', 'projects.find_project', 'projects.assign_employee'];

describe('workflow ceiling + attribution threading', () => {
  it('binds the ceiling on the instance and passes it to every inner step', async () => {
    const { runtime, executor, instances } = rig();
    const result = await runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: {
        ...testContext(),
        origin: 'orchestrator',
        agentId: 'agt_1',
        delegationId: 'dlg_1',
        approvalId: 'apr_1',
        allowedCapabilityIds: CEILING,
      },
      input: INPUT,
    });
    expect(result.ok && result.value.instance.status).toBe('succeeded');
    expect(executor.invocations.length).toBe(3);
    for (const call of executor.invocations) {
      expect(call.context.allowedCapabilityIds).toEqual(CEILING);
      expect(call.context.agentId).toBe('agt_1');
      expect(call.context.delegationId).toBe('dlg_1');
      expect(call.context.approvalId).toBe('apr_1');
      expect(call.approvalBasis).toBe('approval_engine');
    }
    const instance = [...instances.instances.values()][0] as WorkflowInstance;
    expect(instance.allowedCapabilityIds).toEqual(CEILING);
    // Persisted: the ceiling survives snapshot -> hydrate (resume after restart).
    const rehydrated = WorkflowInstance.hydrate(WorkflowInstance.snapshot(instance));
    expect(rehydrated.allowedCapabilityIds).toEqual(CEILING);
  });

  it('scope comes from the instance; the actor is the initiator; a REST start has direct_human basis', async () => {
    const { runtime, executor } = rig();
    const context = {
      ...testContext(),
      workspaceId: 'wsp_scope' as never,
      origin: 'rest',
      allowedCapabilityIds: CEILING,
    };
    await runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context,
      input: INPUT,
    });
    for (const call of executor.invocations) {
      expect(call.context.userId).toBe(context.userId);
      expect(call.context.tenantId).toBe(context.tenantId as TenantId);
      expect(call.context.workspaceId).toBe(context.workspaceId);
      expect(call.context.agentId).toBeUndefined();
      expect(call.context.approvalId).toBeUndefined();
      expect(call.approvalBasis).toBe('direct_human');
    }
  });

  it('a compensation carries the SAME ceiling and names the forward capability it undoes', async () => {
    const { runtime, executor } = rig(['projects.assign_employee']);
    const result = await runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: { ...testContext(), allowedCapabilityIds: CEILING },
      input: INPUT,
    });
    expect(result.ok && result.value.instance.status).toBe('compensated');
    const compensation = executor.invocations.find((call) => call.purpose === 'compensation');
    expect(compensation?.toolId).toBe('hr.revoke_hire');
    expect(compensation?.compensatesCapabilityId).toBe('hr.create_employee');
    expect(compensation?.context.allowedCapabilityIds).toEqual(CEILING);
  });

  it('an empty ceiling is carried as an empty ceiling (permits nothing), never dropped', async () => {
    const { runtime, executor } = rig();
    await runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: { ...testContext(), allowedCapabilityIds: [] },
      input: INPUT,
    });
    expect(executor.invocations[0]?.context.allowedCapabilityIds).toEqual([]);
  });
});
