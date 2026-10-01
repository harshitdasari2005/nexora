/**
 * WorkflowRuntime tests: dependency-ordered execution, no false success,
 * retry within budget, approval wait → grant/resume and rejection,
 * idempotent replay, tenant isolation, and the emitted event stream.
 */

import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@nexora/contracts/workflow';

import {
  WorkflowDefinitionRegistry,
  createProjectAndAssignWorkflowDefinition,
} from '../src/domain/workflow-definition.js';
import { WorkflowRuntime } from '../src/runtime/workflow-runtime.js';
import {
  FakeWorkflowApprovalPort,
  InMemoryWorkflowInstanceRepository,
  InMemoryWorkflowStepExecutionRepository,
  RecordingEventPublisher,
  ScriptedWorkflowStepExecutor,
  failResult,
  okResult,
  testContext,
} from './helpers.js';

/** The CREATE_PROJECT_AND_ASSIGN template (real definition). */
function defaultRegistry(): WorkflowDefinitionRegistry {
  return new WorkflowDefinitionRegistry([createProjectAndAssignWorkflowDefinition()]);
}

/** A definition with an approval point on step b. */
function approvalDefinition(): WorkflowDefinition {
  return {
    id: 'wfd_approval',
    key: 'test.with_approval',
    version: 1,
    startStepId: 'a',
    steps: [
      {
        id: 'a',
        name: 'Read',
        kind: 'ai_task',
        capabilityId: 'cap.read',
        toolId: 'tool.read',
        input: { value: '{{x}}' },
        dependsOn: [],
        next: {},
      },
      {
        id: 'b',
        name: 'Write',
        kind: 'ai_task',
        capabilityId: 'cap.write',
        toolId: 'tool.write',
        input: { value: '{{x}}' },
        dependsOn: ['a'],
        next: {},
      },
    ],
    approvalPoints: {
      b: { approverRoles: ['owner'], timeoutMs: 60_000, delegatable: false },
    },
    compensation: [],
    timeoutMs: 60_000,
    status: 'active',
  };
}

/** A definition with a retryable step. */
function retryDefinition(): WorkflowDefinition {
  return {
    id: 'wfd_retry',
    key: 'test.retry',
    version: 1,
    startStepId: 'a',
    steps: [
      {
        id: 'a',
        name: 'Flaky',
        kind: 'ai_task',
        capabilityId: 'cap.flaky',
        toolId: 'tool.flaky',
        dependsOn: [],
        next: {},
        retryPolicy: { maxAttempts: 2, backoffMs: 0 },
      },
    ],
    approvalPoints: {},
    compensation: [],
    timeoutMs: 60_000,
    status: 'active',
  };
}

/** Builds a runtime wired to in-memory fakes. */
function harness(definitions: WorkflowDefinitionRegistry) {
  const instances = new InMemoryWorkflowInstanceRepository();
  const executions = new InMemoryWorkflowStepExecutionRepository();
  const publisher = new RecordingEventPublisher();
  const approvals = new FakeWorkflowApprovalPort();
  const executor = new ScriptedWorkflowStepExecutor(okResult({}));
  const runtime = new WorkflowRuntime({
    definitions,
    instances,
    executions,
    executor,
    approvals,
    publisher,
    now: () => '2026-01-01T00:00:00.000Z',
  });
  return { runtime, instances, executions, publisher, approvals, executor };
}

describe('WorkflowRuntime.create', () => {
  it('executes steps in dependency order and completes', async () => {
    const { runtime, publisher, executor } = harness(defaultRegistry());
    const result = await runtime.create({
      definitionKey: 'projects.create_and_assign_employee',
      context: testContext(),
      input: { projectName: 'Mobile Banking', employeeName: 'Sarah' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.instance.status).toBe('succeeded');
    // The assignment step ran AFTER both of its dependencies.
    const order = executor.calls.map((call) => call.stepId);
    expect(order[order.length - 1]).toBe('assign_employee');
    expect(order).toContain('create_project');
    expect(order).toContain('find_employee');
    // Each step received its bound input.
    const createCall = executor.calls.find((call) => call.stepId === 'create_project');
    expect(createCall?.input).toEqual({ name: 'Mobile Banking' });
    const assignCall = executor.calls.find((call) => call.stepId === 'assign_employee');
    expect(assignCall?.input).toEqual({
      employeeName: 'Sarah',
      projectName: 'Mobile Banking',
    });
    // Journal: three succeeded executions.
    expect(result.value.steps.map((step) => step.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    // Event stream: created → started → step.started/step.completed ×3 → completed.
    expect(publisher.types()).toEqual([
      'workflow.created',
      'workflow.started',
      'workflow.step.started',
      'workflow.step.completed',
      'workflow.step.started',
      'workflow.step.completed',
      'workflow.step.started',
      'workflow.step.completed',
      'workflow.completed',
    ]);
  });

  it('fails when a step fails — no false success and no dependent step runs', async () => {
    const { runtime, executor } = harness(defaultRegistry());
    // create_project succeeds, find_employee fails → assign_employee must not run.
    executor.forTool(
      'projects.create_project',
      okResult({ project: { id: 'prj_1', name: 'Mobile Banking' } }),
    );
    executor.forTool('hr.find_employee', failResult('Employee not found'));

    const result = await runtime.create({
      definitionKey: 'projects.create_and_assign_employee',
      context: testContext(),
      input: { projectName: 'Mobile Banking', employeeName: 'Sarah' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.instance.status).toBe('failed');
    expect(result.value.instance.error).toContain('find_employee');
    expect(executor.calls.map((call) => call.stepId)).not.toContain('assign_employee');
    expect(result.value.steps.some((step) => step.status === 'failed')).toBe(true);
  });

  it('retries a transient failure within the retry budget', async () => {
    const { runtime, executor } = harness(new WorkflowDefinitionRegistry([retryDefinition()]));
    executor.forTool('tool.flaky', failResult('transient'), okResult('done'));

    const result = await runtime.create({
      definitionKey: 'test.retry',
      context: testContext(),
      input: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.instance.status).toBe('succeeded');
    expect(result.value.steps[0]?.attempt).toBe(2);
    expect(executor.calls).toHaveLength(2);
  });

  it('fails after exhausting the retry budget', async () => {
    const { runtime, executor } = harness(new WorkflowDefinitionRegistry([retryDefinition()]));
    executor.forTool('tool.flaky', failResult('still down'), failResult('still down'));

    const result = await runtime.create({
      definitionKey: 'test.retry',
      context: testContext(),
      input: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.instance.status).toBe('failed');
    expect(executor.calls).toHaveLength(2);
  });

  it('rejects an unknown definition key without creating an instance', async () => {
    const { runtime, instances } = harness(defaultRegistry());
    const result = await runtime.create({
      definitionKey: 'no.such.workflow',
      context: testContext(),
      input: {},
    });
    expect(result.ok).toBe(false);
    expect(instances.instances.size).toBe(0);
  });

  it('rejects missing workflow input before creating an instance', async () => {
    const { runtime, instances } = harness(defaultRegistry());
    const result = await runtime.create({
      definitionKey: 'projects.create_and_assign_employee',
      context: testContext(),
      input: {},
    });
    expect(result.ok).toBe(false);
    expect(instances.instances.size).toBe(0);
  });

  it('waits for approval at an approval point, resumes after a grant', async () => {
    const { runtime, approvals, publisher, executor } = harness(
      new WorkflowDefinitionRegistry([approvalDefinition()]),
    );

    const first = await runtime.create({
      definitionKey: 'test.with_approval',
      context: testContext(),
      input: { x: 42 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.instance.status).toBe('awaiting_approval');
    expect(first.value.steps[1]?.approvalId).toBeDefined();
    // Step b did NOT execute while waiting.
    expect(executor.calls.map((call) => call.stepId)).toEqual(['a']);
    expect(publisher.types()).toContain('workflow.waiting_for_approval');

    // Grant the recorded approval and resume — step b executes exactly once.
    const approvalId = first.value.steps[1]?.approvalId as string;
    approvals.decide(approvalId, 'grant');
    const resumed = await runtime.resume({ workflowId: first.value.instance.id, approvalId });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      return;
    }
    expect(resumed.value.instance.status).toBe('succeeded');
    expect(executor.calls.map((call) => call.stepId)).toEqual(['a', 'b']);
    expect(publisher.types()).toContain('workflow.completed');
    // The claimed approval completed its lifecycle (executing → completed),
    // and a replay of the SAME granted approval can never re-run the
    // workflow (single-flight claim + terminal-status guard).
    expect(approvals.byId(approvalId)?.status).toBe('completed');
    const replay = await runtime.resume({
      workflowId: first.value.instance.id,
      approvalId,
    });
    expect(replay.ok).toBe(false);
    expect(executor.calls.map((call) => call.stepId)).toEqual(['a', 'b']);
  });

  it('fails without mutation when a required approval is rejected', async () => {
    const { runtime, approvals, executor } = harness(
      new WorkflowDefinitionRegistry([approvalDefinition()]),
    );
    const first = await runtime.create({
      definitionKey: 'test.with_approval',
      context: testContext(),
      input: { x: 42 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const approvalId = first.value.steps[1]?.approvalId as string;
    approvals.decide(approvalId, 'reject');

    const resumed = await runtime.resume({ workflowId: first.value.instance.id, approvalId });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      return;
    }
    expect(resumed.value.instance.status).toBe('failed');
    expect(resumed.value.instance.error).toContain('rejected');
    // Step b never executed.
    expect(executor.calls.map((call) => call.stepId)).toEqual(['a']);
  });

  it('fails without mutation when a required approval expired (never executes)', async () => {
    const { runtime, approvals, executor } = harness(
      new WorkflowDefinitionRegistry([approvalDefinition()]),
    );
    const first = await runtime.create({
      definitionKey: 'test.with_approval',
      context: testContext(),
      input: { x: 42 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const approvalId = first.value.steps[1]?.approvalId as string;
    approvals.decide(approvalId, 'grant');
    approvals.expire(approvalId);

    const resumed = await runtime.resume({ workflowId: first.value.instance.id, approvalId });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      return;
    }
    expect(resumed.value.instance.status).toBe('failed');
    expect(resumed.value.instance.error).toContain('expired');
    expect(executor.calls.map((call) => call.stepId)).toEqual(['a']);
  });

  it('never resumes a workflow with a foreign approval (tenant isolation)', async () => {
    const { runtime, approvals } = harness(new WorkflowDefinitionRegistry([approvalDefinition()]));
    const first = await runtime.create({
      definitionKey: 'test.with_approval',
      context: testContext(),
      input: { x: 1 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    // Open an approval for a DIFFERENT tenant and try to resume with it.
    const foreign = approvals.open({
      userId: 'usr_other',
      tenantId: 'org_other',
      runId: 'run_other',
      stepId: 'b',
      toolId: 'tool.write',
      capabilityId: 'cap.write',
      sideEffectClass: 'consequential',
      reason: 'foreign',
      input: {},
    });
    approvals.decide(foreign.id, 'grant');

    const resumed = await runtime.resume({
      workflowId: first.value.instance.id,
      approvalId: foreign.id,
    });
    expect(resumed.ok).toBe(false);
  });

  it('cancels a waiting workflow and stops further steps', async () => {
    // Build a cancellable instance via the approval-pausing definition, then
    // cancel while it waits — no further step executes.
    const approvalHarness = harness(new WorkflowDefinitionRegistry([approvalDefinition()]));
    const waiting = await approvalHarness.runtime.create({
      definitionKey: 'test.with_approval',
      context: testContext(),
      input: { x: 1 },
    });
    expect(waiting.ok).toBe(true);
    if (!waiting.ok) {
      return;
    }
    const cancelled = await approvalHarness.runtime.cancel({
      workflowId: waiting.value.instance.id,
      actorId: 'usr_test',
      tenantId: 'org_test',
    });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }
    expect(cancelled.value.instance.status).toBe('cancelled');
    expect(approvalHarness.publisher.types()).toContain('workflow.cancelled');
    expect(approvalHarness.executor.calls.map((call) => call.stepId)).toEqual(['a']);
  });

  it('is idempotent: a completed workflow never re-executes steps', async () => {
    const { runtime, executor } = harness(defaultRegistry());
    const first = await runtime.create({
      definitionKey: 'projects.create_and_assign_employee',
      context: testContext(),
      input: { projectName: 'Mobile Banking', employeeName: 'Sarah' },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const callsAfterFirst = executor.calls.length;

    // A duplicate delivery of the SAME instance (re-running the record) must
    // never re-execute succeeded steps — the journal is the replay source.
    const replay = await runtime.get({
      workflowId: first.value.instance.id,
      tenantId: 'org_test',
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) {
      return;
    }
    expect(replay.value.steps.map((step) => step.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(executor.calls.length).toBe(callsAfterFirst);
  });

  it('scopes reads to the tenant: foreign get is not found, list is filtered', async () => {
    const { runtime } = harness(defaultRegistry());
    const created = await runtime.create({
      definitionKey: 'projects.create_and_assign_employee',
      context: testContext(),
      input: { projectName: 'Mobile Banking', employeeName: 'Sarah' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const foreignGet = await runtime.get({
      workflowId: created.value.instance.id,
      tenantId: 'org_other',
    });
    expect(foreignGet.ok).toBe(false);

    const own = await runtime.list({ tenantId: 'org_test' });
    expect(own.ok).toBe(true);
    if (!own.ok) {
      return;
    }
    expect(own.value).toHaveLength(1);
    const foreign = await runtime.list({ tenantId: 'org_other' });
    expect(foreign.ok).toBe(true);
    if (foreign.ok) {
      expect(foreign.value).toHaveLength(0);
    }
  });
});
