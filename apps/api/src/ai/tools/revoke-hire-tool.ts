/**
 * @nexora/app-api — RevokeHireTool.
 *
 * The COMPENSATING tool of the hire step (saga semantics, SAD.md §12.7):
 * when a later step of the hire-and-assign workflow fails, the workflow
 * runtime invokes this tool to offboard the employee the workflow created, so
 * no active, assignable employee is left behind. It calls the SAME HR
 * application layer as every other HR path (`RevokeHireHandler`), which
 * ends the employment through the domain lifecycle
 * (`active → exiting → offboarded`) and RETAINS the record — offboarding is
 * never a delete, so the audit history of the hire survives.
 *
 * Workflow-internal: the tool is registered for execution but has NO
 * discoverable capability and is not exposed through the MCP surface, so no
 * user message, model output, or external client can select it. Its only
 * caller is the workflow engine, which binds `employeeId` from the recorded
 * output of the workflow's own hire step.
 *
 * Security contract (same model as every tool):
 * - Input accepts ONLY `employeeId` — `additionalProperties: false`; identity
 *   and tenant come exclusively from the trusted execution context.
 * - Tenant-scoped: an employee of another organization resolves to NOT FOUND;
 *   a rollback can never touch a foreign record.
 * - Idempotent: an already-offboarded employee succeeds with `changed: false`,
 *   so a retried rollback neither fails nor double-applies.
 * - Verified: success requires the employee to actually be `offboarded`.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { ListEmployeesByIdsHandler, RevokeHireHandler } from '@nexora/application-hr';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';

/** Input contract: ONLY the employee id (identity is never input). */
export interface RevokeHireInput {
  /** The employee the workflow created (bound from its own step output). */
  employeeId: string;
}

/** Output contract of {@link RevokeHireTool}. */
export interface RevokeHireOutput {
  /** The employee after the rollback. */
  employee: {
    /** The employee id. */
    id: string;
    /** The employee name. */
    name: string;
    /** The employment status (`offboarded`). */
    status: string;
  };
  /** `false` when the employee was already offboarded (idempotent replay). */
  changed: boolean;
}

/** The tool manifest: consequential (ends an employment), idempotent (safe to retry). */
export const REVOKE_HIRE_MANIFEST: ToolManifest = {
  id: 'hr.revoke_hire',
  name: 'Revoke hire',
  description: 'Offboards an employee created by a failed workflow (the record is retained)',
  sideEffectClass: 'consequential',
  idempotent: true,
  timeoutMs: 15_000,
  verification: {
    source: 'state_readback',
    limitation:
      'the employee is re-read by id (tenant-scoped) and must be offboarded; the record itself is retained, not deleted',
  },
  inputSchema: {
    type: 'object',
    properties: { employeeId: { type: 'string', minLength: 1, maxLength: 80 } },
    required: ['employeeId'],
    additionalProperties: false,
  },
};

/** The reason recorded on the offboarding event. */
const REVOKE_REASON = 'Rolled back: the hire workflow did not complete';

/** The compensating write tool of the hire step. */
export class RevokeHireTool implements Tool<RevokeHireInput, RevokeHireOutput> {
  readonly manifest = REVOKE_HIRE_MANIFEST;

  readonly #revokeHire: RevokeHireHandler;
  readonly #listOrganizations: ListOrganizationsHandler;
  readonly #listEmployeesByIds: ListEmployeesByIdsHandler;

  constructor(dependencies: {
    /** The application-layer revoke-hire command handler. */
    revokeHire: RevokeHireHandler;
    /** Resolves the caller's organization memberships (authorization rule). */
    listOrganizations: ListOrganizationsHandler;
    /** Tenant-scoped employee by-id read (independent read-back of the offboarding). */
    listEmployeesByIds: ListEmployeesByIdsHandler;
  }) {
    this.#listEmployeesByIds = dependencies.listEmployeesByIds;
    this.#revokeHire = dependencies.revokeHire;
    this.#listOrganizations = dependencies.listOrganizations;
  }

  async execute(
    input: RevokeHireInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<RevokeHireOutput>> {
    const employeeId = typeof input?.employeeId === 'string' ? input.employeeId.trim() : '';
    if (employeeId.length === 0) {
      return this.#failure('An employee id is required');
    }

    // Authorization mirrors the other HR tools: membership of the trusted tenant.
    const membership = await this.#listOrganizations.handle({ userId: context.userId as UserId });
    if (!membership.ok || !membership.value.some((org) => org.id === context.tenantId)) {
      return this.#failure('You are not authorized to revoke a hire in this organization');
    }

    const result = await this.#revokeHire.handle({
      organizationId: context.tenantId as TenantId,
      employeeId,
      actorId: context.userId as UserId,
      correlationId: context.executionId,
      reason: REVOKE_REASON,
    });
    if (!result.ok) {
      return this.#failure(revokeHireErrorMessage(result.error));
    }

    // Verify the authoritative result: the employee must really be offboarded.
    const employee = result.value.employee;
    if (employee.organizationId !== context.tenantId || employee.status.value !== 'offboarded') {
      return this.#verificationFailure(
        'Rollback verification failed: the employee was not offboarded',
      );
    }

    // Independent read-back: the employee must be persisted as offboarded (a
    // handler that reports success without ending the employment is UNVERIFIED).
    const readBack = await this.#listEmployeesByIds.handle({
      organizationId: context.tenantId as TenantId,
      ids: [employee.id],
    });
    const persisted =
      readBack.ok &&
      readBack.value.some(
        (row) =>
          row.id === employee.id &&
          row.organizationId === context.tenantId &&
          row.status === 'offboarded',
      );
    if (!persisted) {
      return this.#verificationFailure(
        'Rollback verification failed: the employee is not offboarded on read-back',
      );
    }

    return {
      ok: true,
      output: {
        employee: { id: employee.id, name: employee.name.value, status: employee.status.value },
        changed: result.value.changed,
      },
      completedAt: new Date().toISOString(),
    };
  }

  /** A failed read-back: failed AND unverified with the declared source. */
  #verificationFailure(error: string): ToolResult<RevokeHireOutput> {
    return { ...this.#failure(error), readBackFailed: true };
  }

  #failure(error: string): ToolResult<RevokeHireOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}

/** Maps an application error to a safe message (never internals). */
function revokeHireErrorMessage(error: { code?: string }): string {
  switch (error.code) {
    case 'NOT_FOUND':
      return 'The employee to roll back could not be found';
    case 'BUSINESS_RULE_VIOLATION':
      return 'The employee is in a state that cannot be safely rolled back';
    default:
      return 'Could not roll back the hire';
  }
}
