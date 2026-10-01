/**
 * RevokeHireTool — the workflow-internal compensation of the hire step.
 *
 * Pins its safety contract: employee-id-only input, tenant membership rule,
 * verification that the employee really is offboarded, idempotent replay, safe
 * error messages, and that it is executable but NOT a discoverable capability.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Result } from '@nexora/shared/result';
import { Employee, type EmployeeEventContext } from '@nexora/domain-hr';
import type {
  ListEmployeesByIdsHandler,
  RevokeHireHandler,
  RevokeHireResult,
} from '@nexora/application-hr';
import type { ListOrganizationsHandler, OrganizationDto } from '@nexora/application-organizations';

import { RevokeHireTool } from '../src/ai/tools/revoke-hire-tool.js';

const TENANT = 'org_acme';
const context: EmployeeEventContext = {
  actor: { kind: 'user', id: 'usr_alice' },
  correlationId: 'corr_1',
  organizationId: TENANT as EmployeeEventContext['organizationId'],
};

function offboardedEmployee(organizationId = TENANT): Employee {
  const ctx = {
    ...context,
    organizationId: organizationId as EmployeeEventContext['organizationId'],
  };
  const employee = Employee.create({ organizationId: ctx.organizationId, name: 'Rohan Das' }, ctx);
  employee.hire(ctx);
  employee.onboard(ctx);
  employee.activate(ctx);
  employee.startOffboarding(ctx);
  employee.offboard(ctx, 'test');
  return employee;
}

const org = (id = TENANT): OrganizationDto => ({
  id,
  slug: 'acme',
  name: 'Acme',
  type: 'startup',
  status: 'active',
  createdAt: '2026-08-08T00:00:00.000Z',
});

/** An honest read-back: the persisted employee mirrors the handler's employee (or the override). */
function readBackOf(
  result: Result<RevokeHireResult, { code?: string }>,
  override?: { status?: string; organizationId?: string; missing?: boolean },
) {
  const rows =
    result.ok && override?.missing !== true
      ? [
          {
            id: result.value.employee.id,
            organizationId: override?.organizationId ?? result.value.employee.organizationId,
            name: result.value.employee.name.value,
            status: override?.status ?? result.value.employee.status.value,
            createdAt: '2026-08-08T00:00:00.000Z',
          },
        ]
      : [];
  return {
    handle: vi.fn(async () => ({ ok: true, value: rows })),
  } as unknown as ListEmployeesByIdsHandler;
}

function build(
  result: Result<RevokeHireResult, { code?: string }>,
  organizations = [org()],
  readBack?: Parameters<typeof readBackOf>[1],
) {
  const listEmployeesByIds = readBackOf(result, readBack);
  const revokeHire = { handle: vi.fn(async () => result) } as unknown as RevokeHireHandler;
  const listOrganizations = {
    handle: vi.fn(async () => ({ ok: true, value: organizations })),
  } as unknown as ListOrganizationsHandler;
  return {
    tool: new RevokeHireTool({ revokeHire, listOrganizations, listEmployeesByIds }),
    revokeHire,
    listEmployeesByIds,
  };
}

const trusted = { userId: 'usr_alice', tenantId: TENANT, executionId: 'run_1' };

describe('RevokeHireTool', () => {
  it('is consequential and idempotent (safe to retry), employee-id-only', () => {
    const { tool } = build({
      ok: true,
      value: { employee: offboardedEmployee(), events: [], changed: true },
    });
    expect(tool.manifest.id).toBe('hr.revoke_hire');
    expect(tool.manifest.sideEffectClass).toBe('consequential');
    expect(tool.manifest.idempotent).toBe(true);
    expect(tool.manifest.inputSchema).toMatchObject({
      required: ['employeeId'],
      additionalProperties: false,
    });
  });

  it('offboards through the handler under the TRUSTED tenant and user', async () => {
    const employee = offboardedEmployee();
    const { tool, revokeHire } = build({
      ok: true,
      value: { employee, events: [], changed: true },
    });
    const result = await tool.execute(
      { employeeId: employee.id, organizationId: 'org_evil', userId: 'usr_evil' } as never,
      trusted,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ employee: { status: 'offboarded' }, changed: true });
    expect(revokeHire.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: TENANT,
        actorId: 'usr_alice',
        employeeId: employee.id,
      }),
    );
  });

  it('reports an idempotent replay as success with changed=false', async () => {
    const employee = offboardedEmployee();
    const { tool } = build({ ok: true, value: { employee, events: [], changed: false } });
    const result = await tool.execute({ employeeId: employee.id }, trusted);
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ changed: false });
  });

  it('refuses a caller who is not a member of the trusted tenant', async () => {
    const employee = offboardedEmployee();
    const { tool, revokeHire } = build(
      { ok: true, value: { employee, events: [], changed: true } },
      [org('org_other')],
    );
    const result = await tool.execute({ employeeId: employee.id }, trusted);
    expect(result.ok).toBe(false);
    expect(revokeHire.handle).not.toHaveBeenCalled();
  });

  it('fails verification when the employee is not actually offboarded', async () => {
    const employee = offboardedEmployee('org_foreign');
    const { tool } = build({ ok: true, value: { employee, events: [], changed: true } });
    const result = await tool.execute({ employeeId: employee.id }, trusted);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('verification failed');
  });

  it('maps failures to safe messages (no internals)', async () => {
    const notFound = build({ ok: false, error: { code: 'NOT_FOUND' } });
    expect((await notFound.tool.execute({ employeeId: 'emp_x' }, trusted)).error).toBe(
      'The employee to roll back could not be found',
    );
    const blocked = build({ ok: false, error: { code: 'BUSINESS_RULE_VIOLATION' } });
    expect((await blocked.tool.execute({ employeeId: 'emp_x' }, trusted)).error).toContain(
      'cannot be safely rolled back',
    );
    expect((await notFound.tool.execute({ employeeId: '  ' }, trusted)).ok).toBe(false);
  });

  describe('independent read-back (a lying handler is UNVERIFIED)', () => {
    const okResult = () => {
      const employee = offboardedEmployee();
      return {
        employee,
        result: { ok: true, value: { employee, events: [], changed: true } } as const,
      };
    };

    it('positive control: persisted offboarded state verifies', async () => {
      const { employee, result } = okResult();
      const { tool, listEmployeesByIds } = build(result);
      const out = await tool.execute({ employeeId: employee.id }, trusted);
      expect(out.ok).toBe(true);
      expect(listEmployeesByIds.handle).toHaveBeenCalledWith({
        organizationId: TENANT,
        ids: [employee.id],
      });
      expect(tool.manifest.verification?.source).toBe('state_readback');
    });

    it.each([
      ['still active', { status: 'active' }],
      ['missing', { missing: true }],
      ['foreign tenant row', { organizationId: 'org_other' }],
    ])('handler says offboarded but the persisted employee is %s', async (_label, override) => {
      const { employee, result } = okResult();
      const { tool } = build(result, [org()], override);
      const out = await tool.execute({ employeeId: employee.id }, trusted);
      expect(out.ok).toBe(false);
      expect(out.readBackFailed).toBe(true);
    });
  });
});
