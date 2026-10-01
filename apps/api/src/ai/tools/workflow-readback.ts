/**
 * @nexora/app-api — independent persisted-state read-back for the composite
 * workflow tools.
 *
 * `instance.status === 'succeeded'` is the workflow engine's OWN claim. Before
 * the composite tool reports success it re-reads what the workflow produced —
 * the created employee / project and the assignment — through the tenant-scoped
 * READ handlers (a path that does not go through the write handlers or the
 * journal), and requires the persisted state to match the journaled step
 * outputs. A mismatch is a `readBackFailed` (unverified) result.
 *
 * Limitation (declared on the manifests): the composite is verified through the
 * three business facts above; the inner steps' own verification is recorded on
 * their own executions, and the journal itself is not re-derived.
 */

import type { TenantId } from '@nexora/contracts/common';
import type { ListEmployeesByIdsHandler } from '@nexora/application-hr';
import type { ListProjectMembersHandler, ListProjectsHandler } from '@nexora/application-projects';

/** The read handlers a composite read-back uses. */
export interface WorkflowReadBackDependencies {
  listEmployeesByIds: ListEmployeesByIdsHandler;
  listProjects: ListProjectsHandler;
  listProjectMembers: ListProjectMembersHandler;
}

/** The journaled steps of a finished workflow instance (only what read-back needs). */
export interface JournaledStep {
  stepId: string;
  status: string;
  output?: unknown;
}

/** Whether the label of a persisted record equals the requested one (case-insensitive, trimmed). */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function outputOf(steps: readonly JournaledStep[], stepId: string): Record<string, unknown> {
  const step = steps.find(
    (candidate) => candidate.stepId === stepId && candidate.status === 'succeeded',
  );
  return (step?.output ?? {}) as Record<string, unknown>;
}

function pick(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function projectExists(
  deps: WorkflowReadBackDependencies,
  tenantId: string,
  projectId: string,
  expectedName?: string,
): Promise<boolean> {
  const projects = await deps.listProjects.handle({ organizationId: tenantId as TenantId });
  return (
    projects.ok &&
    projects.value.some(
      (project) =>
        project.id === projectId &&
        project.organizationId === tenantId &&
        (expectedName === undefined || sameName(project.name, expectedName)),
    )
  );
}

async function assignmentPersisted(
  deps: WorkflowReadBackDependencies,
  tenantId: string,
  assignment: { id: string; projectId: string; employeeId: string },
): Promise<boolean> {
  const members = await deps.listProjectMembers.handle({
    organizationId: tenantId as TenantId,
    projectId: assignment.projectId,
  });
  return (
    members.ok &&
    members.value.some(
      (member) =>
        member.id === assignment.id &&
        member.projectId === assignment.projectId &&
        member.employeeId === assignment.employeeId,
    )
  );
}

/**
 * Re-reads the hire-and-assign outcome: the hired employee exists in the tenant
 * with the requested name and is not offboarded/cancelled, the project exists,
 * and the assignment is in the project's persisted member list.
 * Returns an error message on mismatch, `undefined` when verified.
 */
export async function verifyHireAndAssign(
  deps: WorkflowReadBackDependencies,
  tenantId: string,
  steps: readonly JournaledStep[],
  requested: { employeeName: string },
): Promise<string | undefined> {
  const employeeId = pick(outputOf(steps, 'hire_employee'), 'employee', 'id');
  const assignment = pick(outputOf(steps, 'assign_employee'), 'assignment') as
    { id?: string; projectId?: string; employeeId?: string } | undefined;
  if (
    typeof employeeId !== 'string' ||
    typeof assignment?.id !== 'string' ||
    typeof assignment.projectId !== 'string' ||
    assignment.employeeId !== employeeId
  ) {
    return 'Workflow verification failed: the journal does not describe a consistent hire and assignment';
  }
  const employees = await deps.listEmployeesByIds.handle({
    organizationId: tenantId as TenantId,
    ids: [employeeId],
  });
  const employee = employees.ok
    ? employees.value.find((row) => row.id === employeeId && row.organizationId === tenantId)
    : undefined;
  if (
    employee === undefined ||
    !sameName(employee.name, requested.employeeName) ||
    employee.status === 'offboarded' ||
    employee.status === 'cancelled'
  ) {
    return 'Workflow verification failed: the hired employee was not found on read-back';
  }
  if (!(await projectExists(deps, tenantId, assignment.projectId))) {
    return 'Workflow verification failed: the project was not found on read-back';
  }
  if (
    !(await assignmentPersisted(deps, tenantId, {
      id: assignment.id,
      projectId: assignment.projectId,
      employeeId,
    }))
  ) {
    return 'Workflow verification failed: the assignment was not found on read-back';
  }
  return undefined;
}

/**
 * Re-reads the create-project-and-assign outcome: the created project exists in
 * the tenant with the requested name, the resolved employee exists in the
 * tenant, and the assignment links them in the persisted member list.
 */
export async function verifyCreateProjectAndAssign(
  deps: WorkflowReadBackDependencies,
  tenantId: string,
  steps: readonly JournaledStep[],
  requested: { projectName: string },
): Promise<string | undefined> {
  const projectId = pick(outputOf(steps, 'create_project'), 'project', 'id');
  const assignment = pick(outputOf(steps, 'assign_employee'), 'assignment') as
    { id?: string; projectId?: string; employeeId?: string } | undefined;
  if (
    typeof projectId !== 'string' ||
    typeof assignment?.id !== 'string' ||
    typeof assignment.employeeId !== 'string' ||
    assignment.projectId !== projectId
  ) {
    return 'Workflow verification failed: the journal does not describe a consistent project and assignment';
  }
  if (!(await projectExists(deps, tenantId, projectId, requested.projectName))) {
    return 'Workflow verification failed: the created project was not found on read-back';
  }
  const employees = await deps.listEmployeesByIds.handle({
    organizationId: tenantId as TenantId,
    ids: [assignment.employeeId],
  });
  const employeeFound =
    employees.ok &&
    employees.value.some(
      (row) => row.id === assignment.employeeId && row.organizationId === tenantId,
    );
  if (!employeeFound) {
    return 'Workflow verification failed: the assigned employee was not found on read-back';
  }
  if (
    !(await assignmentPersisted(deps, tenantId, {
      id: assignment.id,
      projectId,
      employeeId: assignment.employeeId,
    }))
  ) {
    return 'Workflow verification failed: the assignment was not found on read-back';
  }
  return undefined;
}
