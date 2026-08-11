/**
 * CreateEmployee application-layer tests: the use case validates input,
 * creates + activates through the domain, publishes events once, and maps
 * failures to the canonical error vocabulary.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@nexora/shared/errors';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { CreateEmployeeCommand } from '@nexora/application-hr';

import { CreateEmployeeHandler, EmployeeApplicationService } from '../src/index.js';
import {
  domainService,
  FakeEmployeeRepository,
  RecordingEventPublisher,
  TENANT,
} from './helpers.js';

function service(
  repository = new FakeEmployeeRepository(),
  publisher = new RecordingEventPublisher(),
) {
  const app = new EmployeeApplicationService({
    employeesService: domainService(repository),
    publisher,
  });
  return { app, repository, publisher };
}

const command: CreateEmployeeCommand = {
  organizationId: TENANT,
  name: 'Sarah Chen',
  actorId: 'usr_alex' as UserId,
  correlationId: 'corr_1',
};

describe('EmployeeApplicationService.createEmployee', () => {
  it('creates an active employee and publishes the full lifecycle event chain', async () => {
    const { app, repository, publisher } = service();
    const result = await app.createEmployee(command);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.employee.status.value).toBe('active');
    expect(result.value.employee.name.value).toBe('Sarah Chen');
    expect(repository.employees.size).toBe(1);
    // The HR vocabulary records `created` and `activated`; hire/onboard are
    // intermediate lifecycle steps without dedicated events.
    expect(publisher.published.map((event) => event.type)).toEqual([
      'employee.created',
      'employee.activated',
    ]);
    expect(publisher.published.every((event) => event.tenantId === TENANT)).toBe(true);
  });

  it('returns a validation error for an invalid name without any mutation', async () => {
    const { app, repository, publisher } = service();
    const result = await app.createEmployee({ ...command, name: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(repository.employees.size).toBe(0);
    expect(publisher.published).toHaveLength(0);
  });

  it('returns a validation error for an over-long name', async () => {
    const { app } = service();
    const result = await app.createEmployee({ ...command, name: 'x'.repeat(121) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('propagates a domain validation failure (repo untouched, no events)', async () => {
    const { app, repository, publisher } = service();
    const result = await app.createEmployee({ ...command, name: '' });
    expect(result.ok).toBe(false);
    expect(repository.employees.size).toBe(0);
    expect(publisher.published).toHaveLength(0);
  });

  it('surfaces a repository failure without publishing events', async () => {
    const failing = new (class extends FakeEmployeeRepository {
      override async save(): Promise<void> {
        throw new Error('simulated persistence failure');
      }
    })();
    const { app, publisher } = service(failing);
    const result = await app.createEmployee(command);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(publisher.published).toHaveLength(0);
  });

  it('is tenant-scoped: the employee belongs to the trusted organization', async () => {
    const { app, repository } = service();
    const result = await app.createEmployee(command);
    expect(result.ok).toBe(true);
    const created = [...repository.employees.values()][0];
    expect(created?.organizationId).toBe(TENANT);
  });
});

describe('CreateEmployeeHandler', () => {
  it('delegates to the application service', async () => {
    const { app, repository } = service();
    const handler = new CreateEmployeeHandler(app);
    const result = await handler.handle(command);
    expect(result.ok).toBe(true);
    expect(repository.employees.size).toBe(1);
  });
});

describe('tenant isolation', () => {
  it('never crosses the tenant boundary when creating', async () => {
    const { app, repository } = service();
    await app.createEmployee(command);
    await app.createEmployee({
      ...command,
      organizationId: 'org_alien' as TenantId,
      name: 'Alien',
    });
    const tenants = new Set([...repository.employees.values()].map((e) => e.organizationId));
    expect(tenants).toEqual(new Set([TENANT, 'org_alien']));
    // The trusted command tenant is always the aggregate owner.
    expect([...repository.employees.values()][0]?.organizationId).toBe(TENANT);
  });
});
