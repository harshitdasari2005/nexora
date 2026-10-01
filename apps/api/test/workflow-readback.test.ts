/**
 * Composite workflow tools — independent read-back.
 *
 * `instance.status === 'succeeded'` is the workflow engine's own claim. A
 * composite that the engine calls successful but whose employee / project /
 * assignment is not in persisted state must be UNVERIFIED (`readBackFailed`).
 */

import { describe, expect, it } from 'vitest';
import {
  ASSIGN_EMPLOYEE_CAPABILITY,
  CREATE_PROJECT_CAPABILITY,
  FIND_EMPLOYEE_CAPABILITY,
  FIND_PROJECT_CAPABILITY,
  HIRE_EMPLOYEE_CAPABILITY,
} from '@nexora/module-workflow';

import { HireAndAssignWorkflowTool } from '../src/ai/tools/hire-and-assign-tool.js';
import { CreateProjectAndAssignWorkflowTool } from '../src/ai/tools/create-project-and-assign-tool.js';

const TENANT = 'org_a';
const context = { userId: 'usr_a', tenantId: TENANT, executionId: 'run_1' };

const employeeRow = (over: Record<string, unknown> = {}) => ({
  id: 'emp_1',
  organizationId: TENANT,
  name: 'Sarah Khan',
  status: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
});
const projectRow = (over: Record<string, unknown> = {}) => ({
  id: 'prj_1',
  organizationId: TENANT,
  name: 'Mobile Banking',
  ...over,
});
const memberRow = (over: Record<string, unknown> = {}) => ({
  id: 'asg_1',
  projectId: 'prj_1',
  employeeId: 'emp_1',
  assignedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

function step(stepId: string, output: unknown) {
  return {
    stepId,
    name: stepId,
    capabilityId: stepId,
    toolId: stepId,
    status: 'succeeded',
    output,
  };
}

const assignOutput = {
  assignment: { id: 'asg_1', projectId: 'prj_1', employeeId: 'emp_1' },
};

function record(steps: unknown[]) {
  return {
    instance: {
      id: 'wfi_1',
      definitionKey: 'x',
      status: 'succeeded',
      startedAt: '2026-09-01T00:00:00.000Z',
      finishedAt: '2026-09-01T00:00:01.000Z',
    },
    steps,
  };
}

function handlers(persisted: { employees?: unknown[]; projects?: unknown[]; members?: unknown[] }) {
  return {
    listEmployeesByIds: {
      handle: async () => ({ ok: true, value: persisted.employees ?? [employeeRow()] }),
    } as never,
    listProjects: {
      handle: async () => ({ ok: true, value: persisted.projects ?? [projectRow()] }),
    } as never,
    listProjectMembers: {
      handle: async () => ({ ok: true, value: persisted.members ?? [memberRow()] }),
    } as never,
  };
}

const common = (steps: unknown[]) => ({
  startWorkflow: { handle: async () => ({ ok: true, value: record(steps) }) } as never,
  listOrganizations: { handle: async () => ({ ok: true, value: [{ id: TENANT }] }) } as never,
});

const hireSteps = [
  step('hire_employee', { employee: { id: 'emp_1', name: 'Sarah Khan' } }),
  step('find_project', { projects: [{ id: 'prj_1' }] }),
  step('assign_employee', assignOutput),
];
const projectSteps = [
  step('create_project', { project: { id: 'prj_1', name: 'Mobile Banking' } }),
  step('find_employee', { employees: [{ id: 'emp_1' }] }),
  step('assign_employee', assignOutput),
];

const hire = (persisted: Parameters<typeof handlers>[0], steps = hireSteps) =>
  new HireAndAssignWorkflowTool({
    ...common(steps),
    ...handlers(persisted),
    resolveInitiatorCapabilities: async () => [
      HIRE_EMPLOYEE_CAPABILITY,
      FIND_PROJECT_CAPABILITY,
      ASSIGN_EMPLOYEE_CAPABILITY,
    ],
  }).execute({ employeeName: 'Sarah Khan', projectName: 'Mobile Banking' }, context);

const createProject = (persisted: Parameters<typeof handlers>[0], steps = projectSteps) =>
  new CreateProjectAndAssignWorkflowTool({
    ...common(steps),
    ...handlers(persisted),
    resolveInitiatorCapabilities: async () => [
      CREATE_PROJECT_CAPABILITY,
      FIND_EMPLOYEE_CAPABILITY,
      ASSIGN_EMPLOYEE_CAPABILITY,
    ],
  }).execute({ employeeName: 'Sarah Khan', projectName: 'Mobile Banking' }, context);

describe('composite workflow read-back', () => {
  it('positive controls: persisted state matching the journal verifies', async () => {
    expect((await hire({})).ok).toBe(true);
    expect((await createProject({})).ok).toBe(true);
  });

  it('declares state_readback with a limitation', () => {
    const tool = new HireAndAssignWorkflowTool({ ...common([]), ...handlers({}) });
    expect(tool.manifest.verification).toMatchObject({ source: 'state_readback' });
    expect(tool.manifest.verification?.limitation).toBeTruthy();
  });

  describe.each([
    ['hire_and_assign', hire],
    ['create_project_and_assign', createProject],
  ] as const)('%s: the engine says succeeded but persisted state disagrees', (_name, run) => {
    it.each([
      ['no persisted assignment', { members: [] }],
      [
        'the assignment belongs to another employee',
        { members: [memberRow({ employeeId: 'emp_9' })] },
      ],
      ['the project does not exist', { projects: [] }],
      ['the employee does not exist', { employees: [] }],
      [
        'the employee is a foreign-tenant row',
        { employees: [employeeRow({ organizationId: 'org_b' })] },
      ],
    ])('%s => unverified', async (_label, persisted) => {
      const result = await run(persisted);
      expect(result.ok).toBe(false);
      expect(result.readBackFailed).toBe(true);
    });
  });

  it('hire: an offboarded or renamed employee is unverified', async () => {
    expect(
      (await hire({ employees: [employeeRow({ status: 'offboarded' })] })).readBackFailed,
    ).toBe(true);
    expect(
      (await hire({ employees: [employeeRow({ name: 'Someone Else' })] })).readBackFailed,
    ).toBe(true);
  });

  it('create-project: a project persisted under another name is unverified', async () => {
    expect(
      (await createProject({ projects: [projectRow({ name: 'Other' })] })).readBackFailed,
    ).toBe(true);
  });

  it('a journal that does not describe the outcome is unverified (never trusted)', async () => {
    expect((await hire({}, [step('assign_employee', assignOutput)])).readBackFailed).toBe(true);
    expect((await createProject({}, [])).readBackFailed).toBe(true);
  });
});
