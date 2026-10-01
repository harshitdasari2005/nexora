/**
 * @nexora/app-api — CreateEmployeeTool.
 *
 * The HR write capability that powers the flagship workflow ("Hire Sarah
 * and assign her to the Mobile Banking project"): creates an employee
 * through the HR application layer — the SAME `CreateEmployeeHandler` the
 * REST surface uses — so humans and AI converge on one business execution
 * path. The application layer walks the employee lifecycle (proposed →
 * hired → onboarding → active, BR-16), so a hired employee is assignable.
 *
 * Security contract (same model as every tool):
 * - Input accepts ONLY the user-controlled `name` — `additionalProperties:
 *   false`. The model can never supply `userId`, `tenantId`,
 *   `organizationId`, `workspaceId`, permissions, or approval state —
 *   identity and tenant come exclusively from the trusted execution
 *   context assembled from the authenticated session.
 * - Authorization mirrors the REST surface (`POST /api/employees`):
 *   membership of the trusted tenant is the rule. "Act as an
 *   administrator" changes nothing.
 * - Delegation: the tool calls the CreateEmployeeHandler (application
 *   layer) — never Drizzle, never repositories, never domain objects.
 * - Verification: the created employee must belong to the trusted tenant;
 *   the model never decides success — the application result is
 *   authoritative.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { CreateEmployeeHandler, ListEmployeesByIdsHandler } from '@nexora/application-hr';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';

/** Input contract: ONLY the user-controlled name (identity is never input). */
export interface CreateEmployeeInput {
  /** The requested employee name (user-controlled business value). */
  name: string;
}

/** Output contract of {@link CreateEmployeeTool}. */
export interface CreateEmployeeOutput {
  /** The created employee (authoritative application-layer result). */
  employee: {
    /** The employee id. */
    id: string;
    /** The name. */
    name: string;
    /** The owning organization (tenant) id — must equal the trusted tenant. */
    organizationId: string;
    /** The employment status (`active` after the v1 lifecycle walk). */
    status: string;
    /** ISO-8601 UTC creation time. */
    createdAt: string;
  };
}

/** The tool manifest: consequential (persistent state change, always gated). */
export const CREATE_EMPLOYEE_MANIFEST: ToolManifest = {
  id: 'hr.create_employee',
  name: 'Hire employee',
  description: 'Hires (creates) a new employee in the current organization',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 15_000,
  // Read-back: the hired employee is re-read by id through the HR query surface.
  verification: { source: 'state_readback' },
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', minLength: 1, maxLength: 120 } },
    required: ['name'],
    additionalProperties: false,
  },
};

/** The maximum name length (mirrors the application validator). */
const NAME_MAX_LENGTH = 120;

/**
 * The write tool that hires an employee through the HR application layer
 * under the trusted execution context.
 */
export class CreateEmployeeTool implements Tool<CreateEmployeeInput, CreateEmployeeOutput> {
  readonly manifest = CREATE_EMPLOYEE_MANIFEST;

  readonly #createEmployee: CreateEmployeeHandler;
  readonly #listOrganizations: ListOrganizationsHandler;
  readonly #listEmployeesByIds: ListEmployeesByIdsHandler;

  constructor(dependencies: {
    /** The application-layer create-employee command handler. */
    createEmployee: CreateEmployeeHandler;
    /** The tenant-scoped by-id read-back handler (verification against persisted state). */
    listEmployeesByIds: ListEmployeesByIdsHandler;
    /** Resolves the caller's organization memberships (authorization rule). */
    listOrganizations: ListOrganizationsHandler;
  }) {
    this.#createEmployee = dependencies.createEmployee;
    this.#listOrganizations = dependencies.listOrganizations;
    this.#listEmployeesByIds = dependencies.listEmployeesByIds;
  }

  async execute(
    input: CreateEmployeeInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<CreateEmployeeOutput>> {
    // 1. Validate the user-controlled input (untrusted model/user values).
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (name.length === 0) {
      return this.#failure('An employee name is required');
    }
    if (name.length > NAME_MAX_LENGTH) {
      return this.#failure(`Employee name must be at most ${NAME_MAX_LENGTH} characters`);
    }

    // 2. Authorization: the caller must be a member of the trusted tenant.
    //    Identity (`userId`) and tenant (`tenantId`) come from the trusted
    //    execution context — never from the prompt or tool arguments.
    const membership = await this.#listOrganizations.handle({
      userId: context.userId as UserId,
    });
    if (!membership.ok || !membership.value.some((org) => org.id === context.tenantId)) {
      return this.#failure('You are not authorized to hire an employee in this organization');
    }

    // 3. Delegate to the application layer (the authoritative path). The
    //    application service drafts and activates the employee (BR-16).
    const result = await this.#createEmployee.handle({
      organizationId: context.tenantId as TenantId,
      name,
      actorId: context.userId as UserId,
      correlationId: context.executionId,
    });
    if (!result.ok) {
      return this.#failure(createEmployeeErrorMessage(result.error));
    }

    // 4. Verify the authoritative result against the trusted tenant. The
    //    model never decides success — the application result is the source
    //    of truth, and this check is defense-in-depth.
    const employee = result.value.employee;
    if (employee.organizationId !== context.tenantId) {
      return this.#verificationFailure('Employee verification failed: unexpected organization');
    }

    // 5. Read-back verification: re-read the employee by id from persisted
    //    state within the trusted tenant. A handler that reported a hire that
    //    is not actually persisted is surfaced as a failure, never success.
    const readBack = await this.#listEmployeesByIds.handle({
      organizationId: context.tenantId as TenantId,
      ids: [employee.id],
    });
    const persisted =
      readBack.ok &&
      readBack.value.some(
        (row) => row.id === employee.id && row.organizationId === context.tenantId,
      );
    if (!persisted) {
      return this.#verificationFailure(
        'Employee verification failed: hired employee not found on read-back',
      );
    }

    return {
      ok: true,
      output: {
        employee: {
          id: employee.id,
          name: employee.name.value,
          organizationId: employee.organizationId,
          status: employee.status.value,
          createdAt: employee.createdAt,
        },
      },
      completedAt: new Date().toISOString(),
    };
  }

  /** A failed read-back / result verification: failed AND unverified with the declared source. */
  #verificationFailure(error: string): ToolResult<CreateEmployeeOutput> {
    return { ...this.#failure(error), readBackFailed: true };
  }

  #failure(error: string): ToolResult<CreateEmployeeOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}

/**
 * Maps an application-layer error to a safe user-facing message (never
 * internal details or stack traces).
 */
function createEmployeeErrorMessage(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 'The employee name is invalid';
    default:
      return 'Could not hire the employee';
  }
}
