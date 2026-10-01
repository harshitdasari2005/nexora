/**
 * RevokeHire (hire compensation) tests: offboards through the domain
 * lifecycle, retains the record, is idempotent, tenant-scoped, and refuses an
 * employee that cannot legally be offboarded.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';
import { Employee } from '@nexora/domain-hr';

import { EmployeeApplicationService } from '../src/index.js';
import {
  domainService,
  FakeEmployeeRepository,
  RecordingEventPublisher,
  TENANT,
} from './helpers.js';

function setup() {
  const repository = new FakeEmployeeRepository();
  const publisher = new RecordingEventPublisher();
  const app = new EmployeeApplicationService({
    employeesService: domainService(repository),
    publisher,
  });
  return { app, repository, publisher };
}

const actorId = 'usr_alex' as UserId;
const revoke = (employeeId: string, organizationId: TenantId = TENANT) => ({
  organizationId,
  employeeId,
  actorId,
  correlationId: 'corr_rollback',
  reason: 'Rolled back',
});

describe('EmployeeApplicationService.revokeHire', () => {
  it('offboards an active employee, retains the record, and publishes employee.offboarded', async () => {
    const { app, repository, publisher } = setup();
    const created = await app.createEmployee({
      organizationId: TENANT,
      name: 'Rohan Das',
      actorId,
      correlationId: 'corr_hire',
    });
    if (!created.ok) throw created.error;
    const id = created.value.employee.id;
    publisher.published.length = 0;

    const result = await app.revokeHire(revoke(id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.employee.status.value).toBe('offboarded');
    // Retained — offboarding is never a delete.
    expect(repository.employees.get(id)?.status.value).toBe('offboarded');
    expect(repository.employees.size).toBe(1);
    expect(publisher.published.map((event) => event.type)).toEqual(['employee.offboarded']);
    expect(publisher.published[0]?.payload).toMatchObject({
      employeeId: id,
      reason: 'Rolled back',
    });
  });

  it('is idempotent: a repeated revoke succeeds with changed=false and no new events', async () => {
    const { app, publisher } = setup();
    const created = await app.createEmployee({
      organizationId: TENANT,
      name: 'Rohan Das',
      actorId,
      correlationId: 'corr_hire',
    });
    if (!created.ok) throw created.error;
    const id = created.value.employee.id;
    await app.revokeHire(revoke(id));
    publisher.published.length = 0;

    const again = await app.revokeHire(revoke(id));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.changed).toBe(false);
    expect(again.value.employee.status.value).toBe('offboarded');
    expect(publisher.published).toHaveLength(0);
  });

  it("treats another organization's employee as NOT FOUND and leaves it untouched", async () => {
    const { app, repository } = setup();
    const created = await app.createEmployee({
      organizationId: TENANT,
      name: 'Rohan Das',
      actorId,
      correlationId: 'corr_hire',
    });
    if (!created.ok) throw created.error;
    const id = created.value.employee.id;

    const result = await app.revokeHire(revoke(id, 'org_other' as TenantId));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(repository.employees.get(id)?.status.value).toBe('active');
  });

  it('refuses an employee that cannot legally reach offboarded (never forces the transition)', async () => {
    const { app, repository } = setup();
    // A proposed employee (never hired) has no path to `offboarded`.
    const proposed = Employee.create(
      { organizationId: TENANT, name: 'Not Hired Yet' },
      { actor: { kind: 'user', id: actorId }, correlationId: 'c', organizationId: TENANT },
    );
    await repository.save(proposed);

    const result = await app.revokeHire(revoke(proposed.id));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(repository.employees.get(proposed.id)?.status.value).toBe('proposed');
  });

  it('rejects an unknown or malformed employee id', async () => {
    const { app } = setup();
    expect((await app.revokeHire(revoke('emp_00000000-0000-4000-8000-000000000000'))).ok).toBe(
      false,
    );
    expect((await app.revokeHire(revoke('not-an-id'))).ok).toBe(false);
  });
});
