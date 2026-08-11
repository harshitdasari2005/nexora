/**
 * @nexora/app-api — HireAndAssignWorkflowTool.
 *
 * The flagship HR workflow-orchestrating AI capability: "Hire Sarah and
 * assign her to the Mobile Banking project." The planner plans ONE step for
 * this tool (the whole workflow is a gated unit); the tool starts the
 * HIRE_AND_ASSIGN_EMPLOYEE workflow through the workflow application service
 * and returns the journaled outcome. The workflow runtime executes the
 * internal steps (hire → find project → assign) through the same governed
 * tool pipeline, honoring the definition's dependency graph — the assignment
 * can never run before the employee exists (created + activated, BR-16) and
 * the project is resolved.
 *
 * Security contract (same model as every tool):
 * - Input accepts ONLY the user-controlled business names (`employeeName`,
 *   `projectName`) — `additionalProperties: false`. The model can never
 *   supply `userId`, `tenantId`, `organizationId`, permissions, approval, or
 *   autonomy tier — identity and tenant come exclusively from the trusted
 *   execution context.
 * - Authorization mirrors the REST surface: membership of the trusted
 *   tenant is the rule. "Act as an administrator" changes nothing.
 * - Delegation: the tool calls the workflow application service — never
 *   Drizzle, repositories, or domain objects directly.
 * - Verification: the workflow result is authoritative; a failed workflow
 *   reports failure (never a misleading success).
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import { HIRE_AND_ASSIGN_WORKFLOW_KEY, type StartWorkflowHandler } from '@nexora/module-workflow';

/** Input contract: ONLY user-controlled business names (identity is never input). */
export interface HireAndAssignWorkflowInput {
  /** The employee name to hire (user-controlled business value). */
  employeeName: string;
  /** The requested project name (user-controlled business value). */
  projectName: string;
}

/** Output contract of {@link HireAndAssignWorkflowTool}. */
export interface HireAndAssignWorkflowOutput {
  /** The journaled workflow outcome (safe display data). */
  workflow: {
    /** The workflow instance id. */
    id: string;
    /** The stable definition key. */
    definitionKey: string;
    /** The final instance status. */
    status: string;
    /** The step timeline (name + capability + status). */
    steps: readonly {
      stepId: string;
      name: string;
      capabilityId: string;
      toolId: string;
      status: string;
    }[];
    /** ISO-8601 UTC timestamps. */
    startedAt: string;
    finishedAt?: string;
  };
  /** A safe, human-readable summary of the outcome. */
  message: string;
}

/** The tool manifest: consequential (persistent mutations, always gated). */
export const HIRE_AND_ASSIGN_WORKFLOW_MANIFEST: ToolManifest = {
  id: 'workflow.hire_and_assign_employee',
  name: 'Hire employee and assign to project',
  description:
    'Hires a new employee and assigns them to an existing project in the current organization',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 30_000,
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

/** The maximum lengths (mirror the application validators). */
const PROJECT_NAME_MAX_LENGTH = 80;
const EMPLOYEE_NAME_MAX_LENGTH = 120;

/**
 * The workflow-orchestrating tool: starts the HIRE_AND_ASSIGN_EMPLOYEE
 * workflow under the trusted execution context and returns the journaled
 * outcome.
 */
export class HireAndAssignWorkflowTool implements Tool<
  HireAndAssignWorkflowInput,
  HireAndAssignWorkflowOutput
> {
  readonly manifest = HIRE_AND_ASSIGN_WORKFLOW_MANIFEST;

  readonly #startWorkflow: StartWorkflowHandler;
  readonly #listOrganizations: ListOrganizationsHandler;

  constructor(dependencies: {
    /** The workflow application start handler. */
    startWorkflow: StartWorkflowHandler;
    /** Resolves the caller's organization memberships (authorization rule). */
    listOrganizations: ListOrganizationsHandler;
  }) {
    this.#startWorkflow = dependencies.startWorkflow;
    this.#listOrganizations = dependencies.listOrganizations;
  }

  async execute(
    input: HireAndAssignWorkflowInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<HireAndAssignWorkflowOutput>> {
    // 1. Validate the user-controlled input (untrusted model/user values).
    const employeeName = typeof input?.employeeName === 'string' ? input.employeeName.trim() : '';
    const projectName = typeof input?.projectName === 'string' ? input.projectName.trim() : '';
    if (employeeName.length === 0 || projectName.length === 0) {
      return this.#failure('Both an employee name and a project name are required');
    }
    if (employeeName.length > EMPLOYEE_NAME_MAX_LENGTH) {
      return this.#failure(`Employee name must be at most ${EMPLOYEE_NAME_MAX_LENGTH} characters`);
    }
    if (projectName.length > PROJECT_NAME_MAX_LENGTH) {
      return this.#failure(`Project name must be at most ${PROJECT_NAME_MAX_LENGTH} characters`);
    }

    // 2. Authorization: the caller must be a member of the trusted tenant.
    //    Identity (`userId`) and tenant (`tenantId`) come from the trusted
    //    execution context — never from the prompt or tool arguments.
    const membership = await this.#listOrganizations.handle({
      userId: context.userId as UserId,
    });
    if (!membership.ok || !membership.value.some((org) => org.id === context.tenantId)) {
      return this.#failure('You are not authorized to run this workflow in this organization');
    }

    // 3. Delegate to the workflow application layer (the authoritative path).
    //    The workflow runs to a terminal state and the journaled outcome is
    //    returned. `correlationId` ties the workflow + its events to this
    //    execution (trusted, server-derived).
    const result = await this.#startWorkflow.handle({
      definitionKey: HIRE_AND_ASSIGN_WORKFLOW_KEY,
      context: {
        userId: context.userId,
        tenantId: context.tenantId as TenantId,
        workspaceId: context.workspaceId as WorkspaceId | undefined,
        correlationId: context.executionId,
      },
      input: { employeeName, projectName },
    });
    if (!result.ok) {
      return this.#failure(hireWorkflowErrorMessage(result.error));
    }

    // 4. Verify: a failed workflow reports failure — never a misleading
    //    success. The instance status is authoritative.
    const record = result.value;
    if (record.instance.status !== 'succeeded') {
      return this.#failure(record.instance.error ?? `Workflow ended in ${record.instance.status}`);
    }

    return {
      ok: true,
      output: {
        workflow: {
          id: record.instance.id,
          definitionKey: record.instance.definitionKey,
          status: record.instance.status,
          steps: record.steps.map((step) => ({
            stepId: step.stepId,
            name: step.name,
            capabilityId: step.capabilityId,
            toolId: step.toolId,
            status: step.status,
          })),
          startedAt: record.instance.startedAt,
          finishedAt: record.instance.finishedAt,
        },
        message: `${employeeName} was hired and assigned to ${projectName} successfully.`,
      },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<HireAndAssignWorkflowOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}

/**
 * Maps a workflow error to a safe user-facing message (never internal
 * details, ids, or stack traces).
 */
function hireWorkflowErrorMessage(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case 'WORKFLOW_DEFINITION_NOT_FOUND':
      return 'The requested workflow is not available';
    case 'WORKFLOW_NOT_FOUND':
      return 'The workflow could not be found';
    case 'WORKFLOW_APPROVAL_ERROR':
      return 'The workflow requires additional input before it can run';
    default:
      return 'The workflow could not be completed';
  }
}
