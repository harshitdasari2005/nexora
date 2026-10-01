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
import {
  ASSIGN_EMPLOYEE_CAPABILITY,
  FIND_PROJECT_CAPABILITY,
  HIRE_AND_ASSIGN_WORKFLOW_KEY,
  HIRE_EMPLOYEE_CAPABILITY,
  describeWorkflowRollback,
  type StartWorkflowHandler,
} from '@nexora/module-workflow';
import type { CompositePreflight } from '../workflow-preflight.js';
import { verifyHireAndAssign, type WorkflowReadBackDependencies } from './workflow-readback.js';
import {
  authorizeWorkflowInitiator,
  type InitiatorCapabilityResolver,
} from '../workflow-initiator.js';

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
  // A composite: each inner step is executed and journaled (and verified) on its own.
  verification: {
    source: 'state_readback',
    limitation:
      "after the workflow succeeded, the created records and the assignment are re-read through the tenant-scoped read handlers; the journal and each inner step's own verification are not re-derived",
  },
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
  readonly #resolveInitiatorCapabilities?: InitiatorCapabilityResolver;
  readonly #preflight?: CompositePreflight;
  readonly #readBack: WorkflowReadBackDependencies;

  constructor(dependencies: {
    /** The workflow application start handler. */
    startWorkflow: StartWorkflowHandler;
    /** Resolves the caller's organization memberships (authorization rule). */
    listOrganizations: ListOrganizationsHandler;
    /**
     * Resolves the initiator's RBAC-granted executable capabilities (trusted
     * membership → role → catalog). Without it the tool falls back to the
     * invoking run's own ceiling and otherwise fails closed.
     */
    resolveInitiatorCapabilities?: InitiatorCapabilityResolver;
    /**
     * Preflights EVERY inner step's policy decision against the outer approval
     * before anything runs (Prompt 9): inner approval governance the unit
     * approval does not cover refuses with `WORKFLOW_INNER_APPROVAL_UNCOVERED`.
     */
    preflight?: CompositePreflight;
    /** Tenant-scoped read handlers for the independent post-workflow read-back. */
    listEmployeesByIds: WorkflowReadBackDependencies['listEmployeesByIds'];
    listProjects: WorkflowReadBackDependencies['listProjects'];
    listProjectMembers: WorkflowReadBackDependencies['listProjectMembers'];
  }) {
    this.#readBack = {
      listEmployeesByIds: dependencies.listEmployeesByIds,
      listProjects: dependencies.listProjects,
      listProjectMembers: dependencies.listProjectMembers,
    };
    this.#startWorkflow = dependencies.startWorkflow;
    this.#listOrganizations = dependencies.listOrganizations;
    this.#resolveInitiatorCapabilities = dependencies.resolveInitiatorCapabilities;
    this.#preflight = dependencies.preflight;
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

    // 2b. Initiator authority (defense in depth): `workflows.execute` alone
    //     grants none of the capabilities the workflow's inner steps use. The
    //     server derives the initiator's executable capabilities from trusted
    //     RBAC (narrowed by the invoking run's own ceiling) and requires ALL
    //     of them before anything starts. The resulting ceiling is bound to
    //     the workflow instance and bounds every inner step + compensation.
    const authority = await authorizeWorkflowInitiator({
      resolver: this.#resolveInitiatorCapabilities,
      scope: {
        userId: context.userId,
        tenantId: context.tenantId,
        ...(context.workspaceId === undefined ? {} : { workspaceId: context.workspaceId }),
      },
      ...(context.allowedCapabilityIds === undefined
        ? {}
        : { runCeiling: context.allowedCapabilityIds }),
      required: [HIRE_EMPLOYEE_CAPABILITY, FIND_PROJECT_CAPABILITY, ASSIGN_EMPLOYEE_CAPABILITY],
    });
    if (!authority.ok) {
      return this.#failure(
        'Your current role does not have permission to perform every step of this workflow',
      );
    }

    // 2c. Preflight every inner step's policy decision against the OUTER
    //     approval BEFORE any step runs: approval governance targeting an inner
    //     capability that the unit approval does not cover refuses here (nothing
    //     is mutated). The baseline approval stays satisfied by the unit approval.
    const refusal = await this.#preflight?.({
      compositeToolId: this.manifest.id,
      context,
      steps: [HIRE_EMPLOYEE_CAPABILITY, FIND_PROJECT_CAPABILITY, ASSIGN_EMPLOYEE_CAPABILITY].map(
        (capabilityId) => ({ capabilityId, toolId: capabilityId }),
      ),
    });
    if (refusal !== undefined) {
      return this.#failure(refusal.message);
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
        // The initiator's RBAC ceiling: applied to EVERY inner step and
        // compensation (an inner capability outside it fails closed).
        allowedCapabilityIds: authority.ceiling,
        // Prompt 4 attribution (trusted, from the executor): the agent
        // principal, its delegation, the authorizing approval, and origin.
        ...(context.origin === undefined ? {} : { origin: context.origin }),
        ...(context.agent === undefined ? {} : { agentId: context.agent.agentId }),
        ...(context.delegationId === undefined ? {} : { delegationId: context.delegationId }),
        ...(context.approvalId === undefined ? {} : { approvalId: context.approvalId }),
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
      // A failed workflow reports its rollback outcome too: what was undone
      // and what (if anything) was left behind — never an implied rollback.
      // The outcome travels as the tool-vetted `detail` (safe to show); the
      // raw failure text stays in `error`.
      const rollback = describeWorkflowRollback(record);
      return this.#failure(
        record.instance.error ?? `Workflow ended in ${record.instance.status}`,
        rollback.length > 0 ? rollback : undefined,
      );
    }

    // 5. Independent read-back: the journal says the instance succeeded; re-read
    //    the persisted business state it claims to have produced.
    const readBackError = await verifyHireAndAssign(
      this.#readBack,
      context.tenantId,
      record.steps,
      { employeeName },
    );
    if (readBackError !== undefined) {
      return { ...this.#failure(readBackError), readBackFailed: true };
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

  #failure(error: string, detail?: string): ToolResult<HireAndAssignWorkflowOutput> {
    return {
      ok: false,
      error,
      ...(detail === undefined ? {} : { detail }),
      completedAt: new Date().toISOString(),
    };
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
