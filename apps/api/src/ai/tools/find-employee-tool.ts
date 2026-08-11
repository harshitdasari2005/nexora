/**
 * @nexora/app-api — FindEmployeeTool.
 *
 * The HR read capability exposed to the Enterprise AI Runtime: resolves an
 * employee by name inside the trusted tenant (HR bounded context). Returns
 * EVERY candidate so the caller distinguishes resolved (exactly one) from
 * ambiguous (multiple) — the system never guesses a person.
 *
 * Security contract (same model as the workspace/project tools):
 * - Input accepts ONLY the user-controlled `name` — `additionalProperties:
 *   false`. Identity and tenant come exclusively from the trusted execution
 *   context; the model cannot scope the search to another tenant.
 * - Authorization is delegated to the HR **application layer**
 *   (`FindEmployeeByNameHandler` — tenant-scoped resolution is the single
 *   access rule). The AI never filters by its own claims.
 */

import type { TenantId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { EmployeeDto, FindEmployeeByNameHandler } from '@nexora/application-hr';

/** Input contract: ONLY the user-controlled name. */
export interface FindEmployeeInput {
  /** The name term to resolve (case-insensitive substring). */
  name: string;
}

/** Output contract of {@link FindEmployeeTool}. */
export interface FindEmployeeOutput {
  /** Every matching employee (tenant-scoped). */
  employees: readonly EmployeeDto[];
  /** True when exactly one candidate was found (resolved). */
  resolved: boolean;
  /** True when more than one candidate matched (ambiguous — ask the user). */
  ambiguous: boolean;
}

/** The tool manifest (read-only, idempotent). */
export const FIND_EMPLOYEE_MANIFEST: ToolManifest = {
  id: 'hr.find_employee',
  name: 'Find employee',
  description: 'Finds an employee by name in the current organization',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 10_000,
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
 * The read tool that resolves employees through the HR application layer
 * under the trusted execution context.
 */
export class FindEmployeeTool implements Tool<FindEmployeeInput, FindEmployeeOutput> {
  readonly manifest = FIND_EMPLOYEE_MANIFEST;

  readonly #findEmployeeByName: FindEmployeeByNameHandler;

  constructor(findEmployeeByName: FindEmployeeByNameHandler) {
    this.#findEmployeeByName = findEmployeeByName;
  }

  async execute(
    input: FindEmployeeInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<FindEmployeeOutput>> {
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (name.length === 0) {
      return this.#failure('An employee name is required');
    }
    if (name.length > NAME_MAX_LENGTH) {
      return this.#failure(`Employee name must be at most ${NAME_MAX_LENGTH} characters`);
    }

    // Tenant scope comes from the trusted execution context only.
    const result = await this.#findEmployeeByName.handle({
      organizationId: context.tenantId as TenantId,
      name,
    });
    if (!result.ok) {
      return this.#failure('Could not find employees');
    }

    const employees = result.value;
    return {
      ok: true,
      output: {
        employees,
        resolved: employees.length === 1,
        ambiguous: employees.length > 1,
      },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<FindEmployeeOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}
