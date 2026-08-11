/**
 * Workflow domain tests: definition validation (unique ids, resolvable
 * start, dependency DAG without cycles, capability/tool references, routing)
 * and the WorkflowInstance lifecycle (validate → mutate → event, transition
 * table, terminal states).
 */

import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@nexora/contracts/workflow';

import {
  CREATE_PROJECT_AND_ASSIGN_WORKFLOW_KEY,
  HIRE_AND_ASSIGN_WORKFLOW_KEY,
  WorkflowDefinitionRegistry,
  createProjectAndAssignWorkflowDefinition,
  hireAndAssignEmployeeWorkflowDefinition,
  validateWorkflowDefinition,
} from '../src/domain/workflow-definition.js';
import { WorkflowDefinitionInvalidError } from '../src/domain/errors.js';
import { WorkflowInstance } from '../src/domain/workflow-instance.js';
import { WorkflowStateTransitionError } from '../src/domain/errors.js';

/** A minimal valid definition for mutation tests. */
function baseDefinition(): WorkflowDefinition {
  return {
    id: 'wfd_test',
    key: 'test.workflow',
    version: 1,
    startStepId: 'a',
    steps: [
      {
        id: 'a',
        name: 'Step A',
        kind: 'ai_task',
        capabilityId: 'cap.a',
        toolId: 'tool.a',
        input: { value: '{{x}}' },
        dependsOn: [],
        next: {},
      },
      {
        id: 'b',
        name: 'Step B',
        kind: 'ai_task',
        capabilityId: 'cap.b',
        toolId: 'tool.b',
        dependsOn: ['a'],
        next: {},
      },
    ],
    approvalPoints: {},
    compensation: [],
    timeoutMs: 60_000,
    status: 'active',
  };
}

describe('validateWorkflowDefinition', () => {
  it('accepts a valid definition', () => {
    const result = validateWorkflowDefinition(baseDefinition());
    expect(result.ok).toBe(true);
  });

  it('rejects duplicate step ids', () => {
    const definition = baseDefinition();
    definition.steps = [
      { ...definition.steps[0]!, id: 'a' },
      { ...definition.steps[1]!, id: 'a' },
    ];
    const result = validateWorkflowDefinition(definition);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join()).toContain('unique');
    }
  });

  it('rejects an unresolvable start step', () => {
    const definition = baseDefinition();
    definition.startStepId = 'missing';
    expect(validateWorkflowDefinition(definition).ok).toBe(false);
  });

  it('rejects unknown dependencies', () => {
    const definition = baseDefinition();
    definition.steps[1]!.dependsOn = ['ghost'];
    expect(validateWorkflowDefinition(definition).ok).toBe(false);
  });

  it('rejects dependency cycles', () => {
    const definition = baseDefinition();
    definition.steps[0]!.dependsOn = ['b'];
    definition.steps[1]!.dependsOn = ['a'];
    const result = validateWorkflowDefinition(definition);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join()).toContain('cycle');
    }
  });

  it('rejects ai_task steps without a capability or tool', () => {
    const definition = baseDefinition();
    definition.steps[0]!.capabilityId = undefined;
    definition.steps[0]!.toolId = undefined;
    expect(validateWorkflowDefinition(definition).ok).toBe(false);
  });

  it('rejects approval points that reference unknown steps', () => {
    const definition = baseDefinition();
    definition.approvalPoints = {
      ghost: { approverRoles: ['admin'], timeoutMs: 1000, delegatable: false },
    };
    expect(validateWorkflowDefinition(definition).ok).toBe(false);
  });

  it('rejects unknown next-step routes', () => {
    const definition = baseDefinition();
    definition.steps[0]!.next = { succeeded: 'ghost' };
    expect(validateWorkflowDefinition(definition).ok).toBe(false);
  });

  it('rejects draft definitions (never executed)', () => {
    const definition = baseDefinition();
    definition.status = 'draft';
    expect(validateWorkflowDefinition(definition).ok).toBe(false);
  });
});

describe('WorkflowDefinitionRegistry', () => {
  it('rejects an invalid definition at registration', () => {
    const invalid = baseDefinition();
    invalid.steps[0]!.dependsOn = ['b'];
    invalid.steps[1]!.dependsOn = ['a'];
    expect(() => new WorkflowDefinitionRegistry([invalid])).toThrow(WorkflowDefinitionInvalidError);
  });

  it('registers the CREATE_PROJECT_AND_ASSIGN_EMPLOYEE template', () => {
    const registry = new WorkflowDefinitionRegistry([createProjectAndAssignWorkflowDefinition()]);
    const definition = registry.getByKey(CREATE_PROJECT_AND_ASSIGN_WORKFLOW_KEY);
    expect(definition).toBeDefined();
    expect(definition?.steps.map((step) => step.id)).toEqual([
      'create_project',
      'find_employee',
      'assign_employee',
    ]);
    // The assignment depends on BOTH the project and the employee lookup.
    expect(definition?.steps[2]?.dependsOn).toEqual(['create_project', 'find_employee']);
    expect(definition?.status).toBe('active');
  });

  it('registers the HIRE_AND_ASSIGN_EMPLOYEE template (flagship HR workflow)', () => {
    const registry = new WorkflowDefinitionRegistry([hireAndAssignEmployeeWorkflowDefinition()]);
    const definition = registry.getByKey(HIRE_AND_ASSIGN_WORKFLOW_KEY);
    expect(definition).toBeDefined();
    expect(definition?.steps.map((step) => step.id)).toEqual([
      'hire_employee',
      'find_project',
      'assign_employee',
    ]);
    // The assignment depends on BOTH the hire and the project resolution.
    expect(definition?.steps[2]?.dependsOn).toEqual(['hire_employee', 'find_project']);
    // The definition itself validates (registered without throwing).
    expect(validateWorkflowDefinition(definition!).ok).toBe(true);
    expect(definition?.status).toBe('active');
  });

  it('registers both shipped templates in the default registry', () => {
    const registry = new WorkflowDefinitionRegistry([
      createProjectAndAssignWorkflowDefinition(),
      hireAndAssignEmployeeWorkflowDefinition(),
    ]);
    expect(registry.getByKey(CREATE_PROJECT_AND_ASSIGN_WORKFLOW_KEY)).toBeDefined();
    expect(registry.getByKey(HIRE_AND_ASSIGN_WORKFLOW_KEY)).toBeDefined();
    expect(registry.all()).toHaveLength(2);
  });
});

describe('WorkflowInstance lifecycle', () => {
  function context() {
    return {
      actor: { kind: 'user' as const, id: 'usr_test' },
      correlationId: 'corr_test',
      tenantId: 'org_test',
    };
  }

  function create() {
    return WorkflowInstance.create(
      {
        definitionId: 'wfd_test',
        definitionKey: 'test.workflow',
        definitionVersion: 1,
        tenantId: 'org_test',
        userId: 'usr_test',
        correlationId: 'corr_test',
        input: { x: 1 },
      },
      context(),
      '2026-01-01T00:00:00.000Z',
    );
  }

  it('starts as created and emits workflow.created', () => {
    const instance = create();
    expect(instance.status).toBe('created');
    const events = instance.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['workflow.created']);
    expect(events[0]!.payload).toMatchObject({ workflowId: instance.id, status: 'created' });
  });

  it('walks created → planning → ready → running and emits workflow.started', () => {
    const instance = create();
    // Drain the creation event; the lifecycle walk emits workflow.started.
    instance.pullDomainEvents();
    instance.plan();
    instance.ready();
    expect(instance.status).toBe('ready');
    instance.start(context());
    expect(instance.status).toBe('running');
    const events = instance.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['workflow.started']);
  });

  it('completes running → succeeded with output and workflow.completed', () => {
    const instance = create();
    instance.pullDomainEvents();
    instance.plan();
    instance.ready();
    instance.start(context());
    instance.pullDomainEvents();
    instance.complete({ project: 'Mobile Banking' }, context());
    expect(instance.status).toBe('succeeded');
    expect(instance.output).toEqual({ project: 'Mobile Banking' });
    expect(instance.isTerminal()).toBe(true);
    expect(instance.pullDomainEvents().map((event) => event.type)).toEqual(['workflow.completed']);
  });

  it('fails running → failed with an error and workflow.failed', () => {
    const instance = create();
    instance.pullDomainEvents();
    instance.plan();
    instance.ready();
    instance.start(context());
    instance.pullDomainEvents();
    instance.fail('Assignment failed', context());
    expect(instance.status).toBe('failed');
    expect(instance.error).toBe('Assignment failed');
    expect(instance.finishedAt).toBeDefined();
    expect(instance.pullDomainEvents().map((event) => event.type)).toEqual(['workflow.failed']);
  });

  it('waits and resumes around an approval (awaiting_approval ⇄ running)', () => {
    const instance = create();
    instance.pullDomainEvents();
    instance.plan();
    instance.ready();
    instance.start(context());
    instance.pullDomainEvents();
    instance.waitForApproval('assign_employee', context());
    expect(instance.status).toBe('awaiting_approval');
    expect(instance.currentStepId).toBe('assign_employee');
    expect(instance.pullDomainEvents().map((event) => event.type)).toEqual([
      'workflow.waiting_for_approval',
    ]);
    instance.resume();
    expect(instance.status).toBe('running');
  });

  it('cancels a running workflow (running → cancelled)', () => {
    const instance = create();
    instance.pullDomainEvents();
    instance.plan();
    instance.ready();
    instance.start(context());
    instance.pullDomainEvents();
    instance.cancel(context());
    expect(instance.status).toBe('cancelled');
    expect(instance.pullDomainEvents().map((event) => event.type)).toEqual(['workflow.cancelled']);
  });

  it('rejects illegal transitions (validate → mutate)', () => {
    const instance = create();
    expect(() => instance.start(context())).toThrow(WorkflowStateTransitionError);
    expect(instance.status).toBe('created');
  });

  it('rejects transitions from a terminal state', () => {
    const instance = create();
    instance.plan();
    instance.ready();
    instance.start(context());
    instance.complete({}, context());
    expect(() => instance.fail('nope', context())).toThrow(WorkflowStateTransitionError);
    expect(instance.status).toBe('succeeded');
  });

  it('round-trips through snapshot and hydrate without events', () => {
    const instance = create();
    instance.plan();
    instance.ready();
    instance.start(context());
    instance.mergeState('project', { id: 'prj_1' });
    const restored = WorkflowInstance.hydrate(WorkflowInstance.snapshot(instance));
    expect(restored.id).toBe(instance.id);
    expect(restored.status).toBe('running');
    expect(restored.state).toEqual({ project: { id: 'prj_1' } });
    expect(restored.version).toBe(instance.version);
    expect(restored.pullDomainEvents()).toEqual([]);
  });
});
