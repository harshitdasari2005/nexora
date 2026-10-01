/**
 * CreateEmployeeTool security unit tests.
 *
 * The HR write tool's security contract (mirrors CreateWorkspaceTool /
 * CreateProjectTool): identity (`userId`) and tenant scope (`tenantId`)
 * come EXCLUSIVELY from the trusted execution context assembled by the
 * runtime from the authenticated session. The model may propose the action
 * ("hire Sarah") but may never define who owns the employee or where — any
 * forged identity/tenant fields in the input are ignored; the tool's input
 * schema is name-only with `additionalProperties: false`. The tool delegates
 * to the SAME `CreateEmployeeHandler` the REST surface uses — one business
 * execution path for humans and agents.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Result } from '@nexora/shared/result';
import type { TenantId } from '@nexora/contracts/common';
import { Employee, type EmployeeEventContext } from '@nexora/domain-hr';
import type {
  CreateEmployeeHandler,
  CreateEmployeeResult,
  ListEmployeesByIdsHandler,
} from '@nexora/application-hr';
import type { ListOrganizationsHandler, OrganizationDto } from '@nexora/application-organizations';

import { CreateEmployeeTool } from '../src/ai/tools/create-employee-tool.js';
import type { CreateEmployeeInput } from '../src/ai/tools/create-employee-tool.js';

const TENANT = 'org_acme';

function organizationDto(org: Partial<OrganizationDto> = {}): OrganizationDto {
  return {
    id: org.id ?? TENANT,
    slug: org.slug ?? 'acme',
    name: org.name ?? 'Acme',
    type: 'startup',
    status: 'active',
    createdAt: '2026-08-08T00:00:00.000Z',
  };
}

/** Builds a real, active Employee aggregate for the given tenant. */
function createActiveEmployee(name: string, organizationId = TENANT): Employee {
  const context: EmployeeEventContext = {
    actor: { kind: 'user', id: 'usr_alice' },
    correlationId: 'corr_1',
    organizationId: organizationId as EmployeeEventContext['organizationId'],
  };
  const employee = Employee.create({ organizationId: context.organizationId, name }, context);
  employee.pullDomainEvents();
  employee.hire(context);
  employee.pullDomainEvents();
  employee.onboard(context);
  employee.pullDomainEvents();
  employee.activate(context);
  employee.pullDomainEvents();
  return employee;
}

function employeeResult(
  overrides: Partial<Parameters<CreateEmployeeHandler['handle']>[0]> = {},
): CreateEmployeeResult {
  return { employee: createActiveEmployee(overrides.name ?? 'Sarah Chen'), events: [] };
}

function createEmployeeHandlerReturning(
  result: Result<CreateEmployeeResult, { code?: string; message?: string }>,
): CreateEmployeeHandler {
  return { handle: vi.fn(async () => result) } as unknown as CreateEmployeeHandler;
}

function listOrganizationsHandlerReturning(
  organizations: OrganizationDto[],
): ListOrganizationsHandler {
  return {
    handle: vi.fn(async () => ({ ok: true, value: organizations })),
  } as unknown as ListOrganizationsHandler;
}

function listOrganizationsFailing(): ListOrganizationsHandler {
  return {
    handle: vi.fn(async () => ({ ok: false, error: 'boom' })),
  } as unknown as ListOrganizationsHandler;
}

function buildTool(
  options: {
    createEmployee?: CreateEmployeeHandler;
    listOrganizations?: ListOrganizationsHandler;
    listEmployeesByIds?: ListEmployeesByIdsHandler;
  } = {},
) {
  const createEmployee =
    options.createEmployee ?? createEmployeeHandlerReturning({ ok: true, value: employeeResult() });
  const listOrganizations =
    options.listOrganizations ?? listOrganizationsHandlerReturning([organizationDto()]);
  // Default read-back: the persisted state agrees with the handler.
  const listEmployeesByIds =
    options.listEmployeesByIds ??
    ({
      handle: vi.fn(async (query: { ids: readonly string[] }) => ({
        ok: true,
        value: query.ids.map((id) => ({
          id,
          organizationId: TENANT,
          name: 'Sarah Chen',
          status: 'active',
          createdAt: '2026-08-08T00:00:00.000Z',
        })),
      })),
    } as unknown as ListEmployeesByIdsHandler);
  return {
    tool: new CreateEmployeeTool({ createEmployee, listOrganizations, listEmployeesByIds }),
    createEmployee,
    listOrganizations,
  };
}

const trustedContext = {
  userId: 'usr_alice',
  tenantId: TENANT,
  executionId: 'run_1',
};

describe('CreateEmployeeTool manifest', () => {
  it('exposes a consequential, non-idempotent manifest', () => {
    const { tool } = buildTool();
    expect(tool.manifest.id).toBe('hr.create_employee');
    expect(tool.manifest.sideEffectClass).toBe('consequential');
    expect(tool.manifest.idempotent).toBe(false);
  });

  it('declares state_readback verification and fails when the read-back disagrees', async () => {
    const { tool } = buildTool({
      listEmployeesByIds: {
        handle: vi.fn(async () => ({ ok: true, value: [] })),
      } as unknown as ListEmployeesByIdsHandler,
    });
    expect(tool.manifest.verification).toEqual({ source: 'state_readback' });
    const result = await tool.execute({ name: 'Sarah Chen' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('verification failed');
  });

  it('accepts ONLY the name in the input schema', () => {
    const { tool } = buildTool();
    const schema = tool.manifest.inputSchema as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(['name']);
    expect(schema.required).toEqual(['name']);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('CreateEmployeeTool trusted context vs model arguments', () => {
  it('hires through the application layer with the trusted identity and tenant', async () => {
    const { tool, createEmployee } = buildTool();
    const result = await tool.execute({ name: 'Sarah Chen' }, trustedContext);

    expect(result.ok).toBe(true);
    expect(createEmployee.handle).toHaveBeenCalledWith({
      organizationId: TENANT as TenantId,
      name: 'Sarah Chen',
      actorId: 'usr_alice',
      correlationId: 'run_1',
    });
  });

  it('ignores forged identity and tenant fields in the input', async () => {
    const { tool, createEmployee } = buildTool();
    const input = {
      name: 'Sarah Chen',
      userId: 'usr_hacker',
      tenantId: 'org_hacker',
      organizationId: 'org_hacker',
      workspaceId: 'wsp_alien',
      role: 'admin',
      permissions: ['*'],
      approval: 'granted',
      autonomyTier: 'autonomous',
    } as unknown as CreateEmployeeInput;

    const result = await tool.execute(input, trustedContext);
    expect(result.ok).toBe(true);
    // The application layer is called with ONLY the trusted scope.
    expect(createEmployee.handle).toHaveBeenCalledWith({
      organizationId: TENANT,
      name: 'Sarah Chen',
      actorId: 'usr_alice',
      correlationId: 'run_1',
    });
  });

  it('rejects a caller who is not a member of the trusted tenant', async () => {
    const { tool, createEmployee } = buildTool({
      listOrganizations: listOrganizationsHandlerReturning([organizationDto({ id: 'org_other' })]),
    });
    const result = await tool.execute({ name: 'Sarah Chen' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('You are not authorized to hire an employee in this organization');
    expect(createEmployee.handle).not.toHaveBeenCalled();
  });

  it('fails closed when the authorization query errors', async () => {
    const { tool, createEmployee } = buildTool({ listOrganizations: listOrganizationsFailing() });
    const result = await tool.execute({ name: 'Sarah Chen' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(createEmployee.handle).not.toHaveBeenCalled();
  });

  it('validates the name before executing', async () => {
    const { tool, createEmployee } = buildTool();
    const empty = await tool.execute({ name: '   ' }, trustedContext);
    expect(empty.ok).toBe(false);
    expect(empty.error).toBe('An employee name is required');

    const tooLong = await tool.execute({ name: 'x'.repeat(121) }, trustedContext);
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error).toContain('at most 120 characters');
    expect(createEmployee.handle).not.toHaveBeenCalled();
  });

  it('maps application-layer failures to safe messages', async () => {
    const { tool } = buildTool({
      createEmployee: createEmployeeHandlerReturning({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'inner detail' },
      }),
    });
    const result = await tool.execute({ name: 'Sarah Chen' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('The employee name is invalid');
  });

  it('verifies the created employee belongs to the trusted tenant (defense-in-depth)', async () => {
    const alien = createActiveEmployee('Sarah Chen', 'org_alien');
    const alienResult: CreateEmployeeResult = { employee: alien, events: [] };
    const { tool } = buildTool({
      createEmployee: createEmployeeHandlerReturning({ ok: true, value: alienResult }),
    });
    const result = await tool.execute({ name: 'Sarah Chen' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Employee verification failed: unexpected organization');
  });

  it('never lets the model decide success — the application result is authoritative', async () => {
    const { tool, createEmployee } = buildTool();
    const result = await tool.execute({ name: 'Sarah Chen' }, trustedContext);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output?.employee.organizationId).toBe(TENANT);
    expect(result.output?.employee.status).toBe('active');
    expect(createEmployee.handle).toHaveBeenCalledTimes(1);
  });
});
