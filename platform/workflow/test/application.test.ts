/**
 * WorkflowApplicationService tests: the command/query surface over the
 * runtime — start returns the journaled record, handlers delegate, reads are
 * tenant-scoped, and cancel/not-found errors surface as typed Results.
 */

import { describe, expect, it } from 'vitest';

import {
  WorkflowDefinitionRegistry,
  createProjectAndAssignWorkflowDefinition,
} from '../src/domain/workflow-definition.js';
import { WorkflowApplicationService } from '../src/application/workflow-application-service.js';
import {
  CancelWorkflowHandler,
  GetWorkflowHandler,
  ListWorkflowsHandler,
  StartWorkflowHandler,
} from '../src/application/workflow-application-service.js';
import { WorkflowRuntime } from '../src/runtime/workflow-runtime.js';
import {
  InMemoryWorkflowInstanceRepository,
  InMemoryWorkflowStepExecutionRepository,
  RecordingEventPublisher,
  ScriptedWorkflowStepExecutor,
  okResult,
  testContext,
} from './helpers.js';

function makeService() {
  const instances = new InMemoryWorkflowInstanceRepository();
  const executions = new InMemoryWorkflowStepExecutionRepository();
  const publisher = new RecordingEventPublisher();
  const executor = new ScriptedWorkflowStepExecutor(okResult({}));
  const runtime = new WorkflowRuntime({
    definitions: new WorkflowDefinitionRegistry([createProjectAndAssignWorkflowDefinition()]),
    instances,
    executions,
    executor,
    publisher,
  });
  return {
    app: new WorkflowApplicationService(runtime),
    instances,
    executions,
    publisher,
    executor,
  };
}

describe('WorkflowApplicationService', () => {
  it('starts a workflow and returns the journaled record', async () => {
    const { app, instances, executions } = makeService();
    const result = await app.start({
      definitionKey: 'projects.create_and_assign_employee',
      context: testContext(),
      input: { projectName: 'Mobile Banking', employeeName: 'Sarah' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.instance.status).toBe('succeeded');
    expect(result.value.steps).toHaveLength(3);
    expect(instances.instances.size).toBe(1);
    expect(executions.executions.size).toBe(3);
  });

  it('returns a typed error for an unknown definition', async () => {
    const { app } = makeService();
    const result = await app.start({
      definitionKey: 'missing.workflow',
      context: testContext(),
      input: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    }
  });

  it('scopes reads to the tenant (foreign get → not found)', async () => {
    const { app } = makeService();
    const started = await app.start({
      definitionKey: 'projects.create_and_assign_employee',
      context: testContext(),
      input: { projectName: 'Mobile Banking', employeeName: 'Sarah' },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const foreign = await app.get({
      workflowId: started.value.instance.id,
      tenantId: 'org_other',
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.error.code).toBe('WORKFLOW_NOT_FOUND');
    }
    const own = await app.get({
      workflowId: started.value.instance.id,
      tenantId: 'org_test',
    });
    expect(own.ok).toBe(true);
  });

  it('lists only the caller tenant workflows', async () => {
    const { app } = makeService();
    await app.start({
      definitionKey: 'projects.create_and_assign_employee',
      context: testContext(),
      input: { projectName: 'Mobile Banking', employeeName: 'Sarah' },
    });
    const list = await app.list({ tenantId: 'org_test' });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value).toHaveLength(1);
    }
    const foreign = await app.list({ tenantId: 'org_other' });
    expect(foreign.ok).toBe(true);
    if (foreign.ok) {
      expect(foreign.value).toHaveLength(0);
    }
  });

  it('handlers delegate to the service (command/query surface)', async () => {
    const { app, instances } = makeService();
    const start = new StartWorkflowHandler(app);
    const get = new GetWorkflowHandler(app);
    const list = new ListWorkflowsHandler(app);
    const cancel = new CancelWorkflowHandler(app);

    const started = await start.handle({
      definitionKey: 'projects.create_and_assign_employee',
      context: testContext(),
      input: { projectName: 'Mobile Banking', employeeName: 'Sarah' },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    // A completed workflow cannot be cancelled (not running).
    const cancelled = await cancel.handle({
      workflowId: started.value.instance.id,
      actorId: 'usr_test',
      tenantId: 'org_test',
    });
    expect(cancelled.ok).toBe(false);

    const record = await get.handle({
      workflowId: started.value.instance.id,
      tenantId: 'org_test',
    });
    expect(record.ok).toBe(true);
    const workflows = await list.handle({ tenantId: 'org_test' });
    expect(workflows.ok).toBe(true);
    if (workflows.ok) {
      expect(workflows.value.map((w) => w.id)).toContain(started.value.instance.id);
    }
    expect(instances.instances.size).toBe(1);
  });
});
