/**
 * @nexora/app-api — AssignEmployeeToProjectTool.
 *
 * The FIRST cross-domain AI orchestration capability (EMPLOYEE → PROJECT
 * ASSIGNMENT). The user proposes the action ("Assign Sarah to the Mobile
 * Banking project"); the tool orchestrates TWO bounded contexts and executes
 * ONLY through the owning application layers, and ONLY after a granted
 * server-side approval (the orchestrator's approval gate).
 *
 * Orchestration (domain boundaries preserved — no merged HR/Projects logic):
 * 1. Resolve the employee by name through the HR application layer
 *    (`FindEmployeeByNameHandler`) — tenant-scoped, deterministic; multiple
 *    matches → clarify, no guessing.
 * 2. Verify the employee is active (BR-16: only active employees are
 *    assignable) — the HR record's status is authoritative.
 * 3. Resolve the project by name through the Projects application layer
 *    (`FindProjectByNameHandler`) — tenant-scoped, deterministic.
 * 4. Delegate the final mutation to the Projects application layer
 *    (`AssignEmployeeToProjectHandler`), which enforces the project's
 *    assignable lifecycle and duplicate-assignment invariants through the
 *    domain.
 *
 * Security contract (same model as CreateWorkspaceTool/CreateProjectTool):
 * - Input accepts ONLY the user-controlled names (`employeeName`,
 *   `projectName`) — `additionalProperties: false`. The model can never
 *   supply `userId`, `tenantId`, `organizationId`, `projectId`, employee
 *   ids, permissions, or approval state — identity and tenant come
 *   exclusively from the trusted execution context.
 * - Authorization is membership of the trusted tenant (the same rule the
 *   REST surface uses — no second authorization system). "Act as an HR
 *   admin" in the prompt changes nothing.
 * - The tool never touches Drizzle, repositories, or domain objects — every
 *   read and write goes through the owning application layer.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { AssignEmployeeToProjectHandler } from '@nexora/application-projects';
import type { FindEmployeeByNameHandler } from '@nexora/application-hr';
import type { FindProjectByNameHandler } from '@nexora/application-projects';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';

/** Input contract: ONLY the user-controlled names (identity is never input). */
export interface AssignEmployeeToProjectInput {
  /** The employee name to resolve (user-controlled). */
  employeeName: string;
  /** The project name to resolve (user-controlled). */
  projectName: string;
}

/** Output contract of {@link AssignEmployeeToProjectTool}. */
export interface AssignEmployeeToProjectOutput {
  /** The created assignment (authoritative application-layer result). */
  assignment: {
    /** The assignment id. */
    id: string;
    /** The project the employee was assigned to. */
    projectId: string;
    /** The assigned employee id. */
    employeeId: string;
    /** The owning organization (tenant) id — must equal the trusted tenant. */
    organizationId: string;
    /** ISO-8601 UTC assignment time. */
    assignedAt: string;
  };
  /** The resolved employee display name (for the user-facing response). */
  employeeName: string;
  /** The resolved project name (for the user-facing response). */
  projectName: string;
}

/** The tool manifest: consequential (persistent business change, always gated). */
export const ASSIGN_EMPLOYEE_MANIFEST: ToolManifest = {
  id: 'projects.assign_employee',
  name: 'Assign employee to project',
  description: 'Assigns an employee to a project in the current organization',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 15_000,
  inputSchema: {
    type: 'object',
    properties: {
      employeeName: { type: 'string', minLength: 1, maxLength: 120 },
      projectName: { type: 'string', minLength: 1, maxLength: 80 },
    },
    required: ['employeeName', 'projectName'],
    additionalProperties: false,
  },
};

/** The maximum name lengths (mirror the application validators). */
const EMPLOYEE_NAME_MAX_LENGTH = 120;
const PROJECT_NAME_MAX_LENGTH = 80;

/**
 * The cross-domain write tool that assigns an employee to a project through
 * the owning application layers under the trusted execution context.
 */
export class AssignEmployeeToProjectTool implements Tool<
  AssignEmployeeToProjectInput,
  AssignEmployeeToProjectOutput
> {
  readonly manifest = ASSIGN_EMPLOYEE_MANIFEST;

  readonly #assignEmployeeToProject: AssignEmployeeToProjectHandler;
  readonly #findEmployeeByName: FindEmployeeByNameHandler;
  readonly #findProjectByName: FindProjectByNameHandler;
  readonly #listOrganizations: ListOrganizationsHandler;

  constructor(dependencies: {
    /** The application-layer assignment command handler (Projects). */
    assignEmployeeToProject: AssignEmployeeToProjectHandler;
    /** The tenant-scoped employee resolution handler (HR). */
    findEmployeeByName: FindEmployeeByNameHandler;
    /** The tenant-scoped project resolution handler (Projects). */
    findProjectByName: FindProjectByNameHandler;
    /** Resolves the caller's organization memberships (authorization rule). */
    listOrganizations: ListOrganizationsHandler;
  }) {
    this.#assignEmployeeToProject = dependencies.assignEmployeeToProject;
    this.#findEmployeeByName = dependencies.findEmployeeByName;
    this.#findProjectByName = dependencies.findProjectByName;
    this.#listOrganizations = dependencies.listOrganizations;
  }

  async execute(
    input: AssignEmployeeToProjectInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<AssignEmployeeToProjectOutput>> {
    // 1. Validate the user-controlled input (untrusted model/user values).
    const employeeName = typeof input?.employeeName === 'string' ? input.employeeName.trim() : '';
    const projectName = typeof input?.projectName === 'string' ? input.projectName.trim() : '';
    if (employeeName.length === 0 || projectName.length === 0) {
      return this.#failure('Both an employee name and a project name are required');
    }
    if (employeeName.length > EMPLOYEE_NAME_MAX_LENGTH) {
      return this.#failure('Employee name is too long');
    }
    if (projectName.length > PROJECT_NAME_MAX_LENGTH) {
      return this.#failure('Project name is too long');
    }

    // 2. Authorization: the caller must be a member of the trusted tenant.
    //    Identity and tenant come from the trusted execution context only.
    const membership = await this.#listOrganizations.handle({
      userId: context.userId as UserId,
    });
    if (!membership.ok || !membership.value.some((org) => org.id === context.tenantId)) {
      return this.#failure('You are not authorized to assign employees in this organization');
    }

    // 3. Resolve the employee through the HR application layer (tenant-scoped).
    //    Multiple matches → clarify; no matches → tell the user; never guess.
    const employees = await this.#findEmployeeByName.handle({
      organizationId: context.tenantId as TenantId,
      name: employeeName,
    });
    if (!employees.ok) {
      return this.#failure('Could not resolve the employee');
    }
    if (employees.value.length === 0) {
      return this.#failure(`No employee named “${employeeName}” was found in this organization`);
    }
    if (employees.value.length > 1) {
      const names = employees.value.map((employee) => employee.name).join(', ');
      return this.#failure(
        `I found multiple employees matching “${employeeName}”: ${names}. Please be more specific.`,
      );
    }
    const employee = employees.value[0]!;

    // 4. Verify the employee is active (BR-16 — only active employees are
    //    assignable). The HR record's status is authoritative.
    if (employee.status !== 'active') {
      return this.#failure(`Employee ${employee.name} is not active and cannot be assigned`);
    }

    // 5. Resolve the project through the Projects application layer
    //    (tenant-scoped). Multiple matches → clarify; none → tell the user.
    const projects = await this.#findProjectByName.handle({
      organizationId: context.tenantId as TenantId,
      name: projectName,
    });
    if (!projects.ok) {
      return this.#failure('Could not resolve the project');
    }
    if (projects.value.length === 0) {
      return this.#failure(`No project named “${projectName}” was found in this organization`);
    }
    if (projects.value.length > 1) {
      const names = projects.value.map((project) => project.name).join(', ');
      return this.#failure(
        `I found multiple projects matching “${projectName}”: ${names}. Please be more specific.`,
      );
    }
    const project = projects.value[0]!;

    // 6. Delegate the final mutation to the Projects application layer. The
    //    domain enforces the assignable lifecycle + duplicate protection.
    const result = await this.#assignEmployeeToProject.handle({
      organizationId: context.tenantId as TenantId,
      projectId: project.id,
      employeeId: employee.id,
      actorId: context.userId as UserId,
      correlationId: context.executionId,
    });
    if (!result.ok) {
      return this.#failure(assignmentErrorMessage(result.error));
    }

    // 7. Verify the authoritative result against the trusted tenant. The
    //    model never decides success — the application layer's result is the
    //    source of truth, and this check is defense-in-depth.
    const assignment = result.value.assignment;
    if (assignment.organizationId !== context.tenantId) {
      return this.#failure('Assignment verification failed: unexpected organization');
    }

    return {
      ok: true,
      output: {
        assignment: {
          id: assignment.id,
          projectId: assignment.projectId,
          employeeId: assignment.employeeId,
          organizationId: assignment.organizationId,
          assignedAt: assignment.assignedAt,
        },
        employeeName: employee.name,
        projectName: project.name,
      },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<AssignEmployeeToProjectOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}

/**
 * Maps an application-layer error to a safe user-facing message (never
 * internal details, ids, or stack traces).
 */
function assignmentErrorMessage(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 'The assignment request is invalid';
    case 'NOT_FOUND':
      return 'The project was not found';
    case 'BUSINESS_RULE_VIOLATION':
      return 'The project is not in an assignable state';
    case 'CONFLICT':
      return 'This employee is already assigned to the project';
    default:
      return 'Could not assign the employee to the project';
  }
}
