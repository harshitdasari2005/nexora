/**
 * Workflow compensation (saga rollback) tests, against the REAL
 * hire-and-assign and create-project-and-assign definitions:
 *
 * - complete success runs no compensation;
 * - a failure after the hire rolls the hire back (compensated) and journals
 *   the compensation as its own audited step;
 * - a failing compensation leaves an honest `failed` ledger, never a claimed
 *   rollback, and is retryable through `recover`;
 * - repeated recovery and repeated runs never duplicate a compensation;
 * - a workflow with no safe compensation reports itself PARTIALLY COMPLETED.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import {
  WorkflowDefinitionRegistry,
  createProjectAndAssignWorkflowDefinition,
  hireAndAssignEmployeeWorkflowDefinition,
} from '../src/domain/workflow-definition.js';
import { describeWorkflowRollback } from '../src/runtime/rollback-summary.js';
import { WorkflowRuntime } from '../src/runtime/workflow-runtime.js';
import {
  InMemoryWorkflowInstanceRepository,
  InMemoryWorkflowStepExecutionRepository,
  RecordingEventPublisher,
  ScriptedWorkflowStepExecutor,
  failResult,
  okResult,
  testContext,
} from './helpers.js';

const HIRED = { employee: { id: 'emp_0a1b2c3d-0000-4000-8000-000000000001', name: 'Rohan Das' } };

interface Rig {
  runtime: WorkflowRuntime;
  executor: ScriptedWorkflowStepExecutor;
  publisher: RecordingEventPublisher;
  instances: InMemoryWorkflowInstanceRepository;
  executions: InMemoryWorkflowStepExecutionRepository;
}

function rig(): Rig {
  const executor = new ScriptedWorkflowStepExecutor(okResult({}));
  const publisher = new RecordingEventPublisher();
  const instances = new InMemoryWorkflowInstanceRepository();
  const executions = new InMemoryWorkflowStepExecutionRepository();
  const runtime = new WorkflowRuntime({
    definitions: new WorkflowDefinitionRegistry([
      hireAndAssignEmployeeWorkflowDefinition(),
      createProjectAndAssignWorkflowDefinition(),
    ]),
    instances,
    executions,
    executor,
    publisher,
  });
  return { runtime, executor, publisher, instances, executions };
}

const HIRE_INPUT = { employeeName: 'Rohan Das', projectName: 'Quantum Ledger' };
const compensationCalls = (executor: ScriptedWorkflowStepExecutor) =>
  executor.calls.filter((call) => call.toolId === 'hr.revoke_hire');

describe('hire-and-assign compensation', () => {
  let r: Rig;
  beforeEach(() => {
    r = rig();
  });

  it('runs no compensation when every step succeeds', async () => {
    r.executor.forTool('hr.create_employee', okResult(HIRED));
    const result = await r.runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: HIRE_INPUT,
    });
    expect(result.ok && result.value.instance.status).toBe('succeeded');
    expect(compensationCalls(r.executor)).toHaveLength(0);
    if (result.ok) expect(result.value.instance.compensation).toBeUndefined();
    expect(r.publisher.types()).not.toContain('workflow.compensated');
  });

  it('rolls the hire back when the assignment step fails', async () => {
    r.executor
      .forTool('hr.create_employee', okResult(HIRED))
      .forTool('projects.assign_employee', failResult('assignment refused'))
      .forTool('hr.revoke_hire', okResult({ employee: { status: 'offboarded' }, changed: true }));

    const result = await r.runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: HIRE_INPUT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { instance, steps } = result.value;

    expect(instance.status).toBe('compensated');
    expect(instance.error).toContain('assign_employee');
    expect(instance.compensation).toEqual({
      status: 'compensated',
      compensatedSteps: ['hire_employee'],
      outstanding: [],
    });
    // The compensation targets the employee the workflow's OWN hire recorded.
    expect(compensationCalls(r.executor)).toEqual([
      {
        toolId: 'hr.revoke_hire',
        stepId: 'compensate:hire_employee',
        input: { employeeId: HIRED.employee.id },
      },
    ]);
    // …and is journaled as an audited step beside the ordinary ones.
    const journaled = steps.find((step) => step.stepId === 'compensate:hire_employee');
    expect(journaled).toMatchObject({ status: 'succeeded', toolId: 'hr.revoke_hire' });
    expect(journaled?.name).toBe('Compensate: Hire employee');
    // Read-only lookups are never "compensated".
    expect(steps.some((step) => step.stepId === 'compensate:find_project')).toBe(false);
    // The failure is still announced (notifications/detection), plus the rollback fact.
    expect(r.publisher.types()).toContain('workflow.failed');
    expect(r.publisher.types()).toContain('workflow.compensated');
    expect(describeWorkflowRollback(result.value)).toBe(
      'Rolled back: Hire employee. Nothing was left behind.',
    );
  });

  it('never compensates a step that did not complete, or the target that was not hired', async () => {
    // The hire itself fails: nothing was created, so there is nothing to undo.
    r.executor.forTool('hr.create_employee', failResult('hire refused'));
    const result = await r.runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: HIRE_INPUT,
    });
    expect(result.ok && result.value.instance.status).toBe('failed');
    expect(compensationCalls(r.executor)).toHaveLength(0);
    if (result.ok) expect(result.value.instance.compensation).toBeUndefined();
  });

  it('reports a FAILED rollback honestly and keeps the workflow failed', async () => {
    r.executor
      .forTool('hr.create_employee', okResult(HIRED))
      .forTool('projects.assign_employee', failResult('assignment refused'))
      .forTool('hr.revoke_hire', failResult('employee is in a state that cannot be rolled back'));

    const result = await r.runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: HIRE_INPUT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.instance.status).toBe('failed');
    expect(result.value.instance.compensation).toMatchObject({
      status: 'failed',
      compensatedSteps: [],
      outstanding: [
        {
          stepId: 'hire_employee',
          name: 'Hire employee',
          reason: expect.stringContaining('compensation failed'),
        },
      ],
    });
    expect(r.publisher.types()).not.toContain('workflow.compensated');
    const note = describeWorkflowRollback(result.value);
    expect(note).toContain('Rollback failed');
    expect(note).toContain('Hire employee');
    expect(note).toContain('can be retried');
  });

  it('retries a failed rollback through recover and ends compensated', async () => {
    r.executor
      .forTool('hr.create_employee', okResult(HIRED))
      .forTool('projects.assign_employee', failResult('assignment refused'))
      .forTool('hr.revoke_hire', failResult('temporary outage'))
      .forTool('hr.revoke_hire', okResult({ employee: { status: 'offboarded' }, changed: true }));
    const started = await r.runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: HIRE_INPUT,
    });
    if (!started.ok) throw started.error;
    expect(started.value.instance.status).toBe('failed');

    const recovered = await r.runtime.recover({
      workflowId: started.value.instance.id,
      tenantId: testContext().tenantId,
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.value.instance.status).toBe('compensated');
    expect(recovered.value.instance.compensation?.status).toBe('compensated');
    // The failure text is unchanged; only the rollback outcome moved on.
    expect(recovered.value.instance.error).toBe(started.value.instance.error);
    // One journal record per compensation, with the attempt counter advanced.
    const journal = recovered.value.steps.filter((s) => s.stepId === 'compensate:hire_employee');
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ status: 'succeeded', attempt: 2 });
    // `workflow.failed` was announced once (at the original failure), not again.
    expect(r.publisher.ofType('workflow.failed')).toHaveLength(1);
    expect(r.publisher.ofType('workflow.compensated')).toHaveLength(1);
  });

  it('keeps a still-failing rollback failed across repeated recovery attempts', async () => {
    r.executor
      .forTool('hr.create_employee', okResult(HIRED))
      .forTool('projects.assign_employee', failResult('assignment refused'))
      .forTool('hr.revoke_hire', failResult('down'), failResult('still down'));
    const started = await r.runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: HIRE_INPUT,
    });
    if (!started.ok) throw started.error;
    const recovered = await r.runtime.recover({
      workflowId: started.value.instance.id,
      tenantId: testContext().tenantId,
    });
    expect(recovered.ok && recovered.value.instance.status).toBe('failed');
    expect(recovered.ok && recovered.value.instance.compensation?.status).toBe('failed');
  });

  it('never re-runs a compensation that already succeeded (duplicate-execution prevention)', async () => {
    r.executor
      .forTool('hr.create_employee', okResult(HIRED))
      .forTool('projects.assign_employee', failResult('assignment refused'))
      .forTool('hr.revoke_hire', okResult({ employee: { status: 'offboarded' }, changed: true }));
    const started = await r.runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: HIRE_INPUT,
    });
    if (!started.ok) throw started.error;
    expect(compensationCalls(r.executor)).toHaveLength(1);

    // Recovery of a fully compensated workflow is refused — nothing to recover.
    const again = await r.runtime.recover({
      workflowId: started.value.instance.id,
      tenantId: testContext().tenantId,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('WORKFLOW_RECOVERY_NOT_APPLICABLE');
    expect(compensationCalls(r.executor)).toHaveLength(1);
  });

  it('refuses concurrent recovery of the same workflow (single-flight)', async () => {
    r.executor
      .forTool('hr.create_employee', okResult(HIRED))
      .forTool('projects.assign_employee', failResult('assignment refused'))
      .forTool('hr.revoke_hire', failResult('down'));
    const started = await r.runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: HIRE_INPUT,
    });
    if (!started.ok) throw started.error;
    const input = { workflowId: started.value.instance.id, tenantId: testContext().tenantId };
    const [a, b] = await Promise.all([r.runtime.recover(input), r.runtime.recover(input)]);
    // Exactly one attempt ran; the other was refused, not raced.
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(compensationCalls(r.executor)).toHaveLength(2); // original attempt + one recovery
  });

  it('scopes recovery to the workflow tenant', async () => {
    r.executor
      .forTool('hr.create_employee', okResult(HIRED))
      .forTool('projects.assign_employee', failResult('assignment refused'))
      .forTool('hr.revoke_hire', failResult('down'));
    const started = await r.runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: HIRE_INPUT,
    });
    if (!started.ok) throw started.error;
    const foreign = await r.runtime.recover({
      workflowId: started.value.instance.id,
      tenantId: 'org_other' as TenantId,
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('refuses recovery of a workflow that never rolled back', async () => {
    r.executor.forTool('hr.create_employee', okResult(HIRED));
    const done = await r.runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: HIRE_INPUT,
    });
    if (!done.ok) throw done.error;
    const result = await r.runtime.recover({
      workflowId: done.value.instance.id,
      tenantId: testContext().tenantId,
    });
    expect(result.ok).toBe(false);
  });
});

describe('create-project-and-assign (no safe compensation)', () => {
  it('reports itself PARTIALLY COMPLETED instead of pretending to roll back', async () => {
    const r = rig();
    r.executor
      .forTool(
        'projects.create_project',
        okResult({ project: { id: 'prj_1', name: 'Payments Hub' } }),
      )
      .forTool('projects.assign_employee', failResult('assignment refused'));
    const result = await r.runtime.create({
      definitionKey: 'projects.create_and_assign_employee',
      context: testContext(),
      input: { projectName: 'Payments Hub', employeeName: 'Priya Sharma' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.instance.status).toBe('failed');
    expect(result.value.instance.compensation).toEqual({
      status: 'partial',
      compensatedSteps: [],
      outstanding: [
        {
          stepId: 'create_project',
          name: 'Create project',
          reason: 'no compensating action is defined for this step',
        },
      ],
    });
    // The read-only lookup is not reported as outstanding work.
    expect(result.value.instance.compensation?.outstanding.map((s) => s.stepId)).toEqual([
      'create_project',
    ]);
    expect(describeWorkflowRollback(result.value)).toContain(
      'Partially completed — NOT rolled back',
    );
    // Nothing is auto-recoverable: recovery is refused with the reason.
    const recover = await r.runtime.recover({
      workflowId: result.value.instance.id,
      tenantId: testContext().tenantId,
    });
    expect(recover.ok).toBe(false);
  });
});

describe('compensation that requires its own approval', () => {
  it('is never run unattended — the step is reported outstanding', async () => {
    const definition = hireAndAssignEmployeeWorkflowDefinition();
    const gated = {
      ...definition,
      compensation: (definition.compensation ?? []).map((spec) => ({
        ...spec,
        requiresApproval: true,
      })),
    };
    const executor = new ScriptedWorkflowStepExecutor(okResult({}));
    executor
      .forTool('hr.create_employee', okResult(HIRED))
      .forTool('projects.assign_employee', failResult('assignment refused'));
    const runtime = new WorkflowRuntime({
      definitions: new WorkflowDefinitionRegistry([gated]),
      instances: new InMemoryWorkflowInstanceRepository(),
      executions: new InMemoryWorkflowStepExecutionRepository(),
      executor,
      publisher: new RecordingEventPublisher(),
    });
    const result = await runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: HIRE_INPUT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(compensationCalls(executor)).toHaveLength(0);
    expect(result.value.instance.compensation).toMatchObject({
      status: 'partial',
      outstanding: [
        { stepId: 'hire_employee', reason: 'its compensation requires a separate human approval' },
      ],
    });
  });
});

describe('compensation building blocks', () => {
  it('resolves dotted placeholders into a step output, and never invents a value', async () => {
    const { resolveStepInput } = await import('../src/domain/input-resolver.js');
    const state = { hire_employee: { employee: { id: 'emp_1' } } };
    expect(resolveStepInput({ id: '{{hire_employee.employee.id}}' }, {}, state)).toEqual({
      id: 'emp_1',
    });
    expect(resolveStepInput({ id: '{{hire_employee.employee.missing}}' }, {}, state)).toEqual({});
    expect(resolveStepInput({ id: '{{nope.employee.id}}' }, {}, state)).toEqual({});
    expect(resolveStepInput({ id: '{{hire_employee.employee.id.deeper}}' }, {}, state)).toEqual({});
  });

  it('allows failed → compensated only (recovery), and no other exit from failed', async () => {
    const { canTransition } = await import('../src/domain/workflow-status.js');
    expect(canTransition('failed', 'compensated')).toBe(true);
    expect(canTransition('failed', 'running')).toBe(false);
    expect(canTransition('failed', 'succeeded')).toBe(false);
    expect(canTransition('succeeded', 'compensated')).toBe(false);
    expect(canTransition('cancelled', 'compensated')).toBe(false);
  });

  it('declares the hire compensation on the shipped definition and validates it', () => {
    const definition = hireAndAssignEmployeeWorkflowDefinition();
    expect(definition.compensation).toEqual([
      {
        forStepId: 'hire_employee',
        capabilityId: 'hr.revoke_hire',
        toolId: 'hr.revoke_hire',
        input: { employeeId: '{{hire_employee.employee.id}}' },
        requiresApproval: false,
      },
    ]);
    // Lookups are read-only; the hire and the assignment are presumed mutating.
    const mutating = definition.steps.filter((s) => s.mutatesState !== false).map((s) => s.id);
    expect(mutating).toEqual(['hire_employee', 'assign_employee']);
  });
});

describe('compensation cannot be redirected by caller input (step-output shadowing)', () => {
  it('refuses undeclared workflow input fields — including one named after a step', async () => {
    const r = rig();
    const result = await r.runtime.create({
      definitionKey: 'hr.hire_and_assign_employee',
      context: testContext(),
      input: {
        ...HIRE_INPUT,
        // An attacker-supplied "output" of the hire step, naming a victim.
        hire_employee: { employee: { id: 'emp_victim' } },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('undeclared fields: hire_employee');
    expect(r.executor.calls).toEqual([]); // nothing ran, nothing was compensated
  });

  it('resolves dotted step-output references from recorded state only, never from input', async () => {
    const { resolveStepInput } = await import('../src/domain/input-resolver.js');
    const input = { hire_employee: { employee: { id: 'emp_victim' } } };
    // No recorded state: the reference resolves to nothing (not to the input).
    expect(resolveStepInput({ id: '{{hire_employee.employee.id}}' }, input, {})).toEqual({});
    // Recorded state wins even when input carries the same key.
    expect(
      resolveStepInput({ id: '{{hire_employee.employee.id}}' }, input, {
        hire_employee: { employee: { id: 'emp_hired_by_this_workflow' } },
      }),
    ).toEqual({ id: 'emp_hired_by_this_workflow' });
  });
});
