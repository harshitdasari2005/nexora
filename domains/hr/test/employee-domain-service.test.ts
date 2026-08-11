/**
 * EmployeeDomainService tests with an in-memory fake repository: creation,
 * activation, name resolution (resolved vs ambiguous), and tenant-scoped
 * reads.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';
import type { EmployeeRepository } from '../src/repositories/index.js';
import {
  EmployeeDomainService,
  EmployeeNotFoundError,
  type Employee,
  type EmployeeId,
} from '../src/index.js';
import { TENANT, userContext } from './helpers.js';

/** In-memory {@link EmployeeRepository}. */
class FakeEmployeeRepository implements EmployeeRepository {
  readonly employees = new Map<string, Employee>();

  async findById(id: EmployeeId): Promise<Employee | undefined> {
    return this.employees.get(id);
  }

  async findByName(organizationId: TenantId, name: string): Promise<readonly Employee[]> {
    const needle = name.trim().toLowerCase();
    return [...this.employees.values()].filter(
      (employee) =>
        employee.organizationId === organizationId &&
        employee.name.value.toLowerCase().includes(needle),
    );
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly Employee[]> {
    return [...this.employees.values()].filter(
      (employee) => employee.organizationId === organizationId,
    );
  }

  async save(employee: Employee): Promise<void> {
    this.employees.set(employee.id, employee);
  }
}

/** Creates and activates an employee in the given organization (full chain). */
async function seedActiveEmployee(
  service: EmployeeDomainService,
  repos: FakeEmployeeRepository,
  name: string,
  organizationId: TenantId = TENANT,
): Promise<Employee> {
  const context = userContext('usr_alex', organizationId);
  const created = await service.create({ organizationId, name }, context);
  if (!created.ok) {
    throw new Error('seed failed');
  }
  let employee = created.value.employee;
  repos.employees.set(employee.id, employee);
  // Walk the legal chain: proposed → hired → onboarding → active.
  const hired = await service.hire(employee.id, context);
  if (!hired.ok) throw new Error('hire failed');
  repos.employees.set(hired.value.employee.id, hired.value.employee);
  const onboarded = await service.onboard(hired.value.employee.id, context);
  if (!onboarded.ok) throw new Error('onboard failed');
  repos.employees.set(onboarded.value.employee.id, onboarded.value.employee);
  const activated = await service.activate(onboarded.value.employee.id, context);
  if (!activated.ok) {
    throw new Error('activate failed');
  }
  repos.employees.set(activated.value.employee.id, activated.value.employee);
  employee = activated.value.employee;
  return employee;
}

function build() {
  const repos = new FakeEmployeeRepository();
  const service = new EmployeeDomainService({ employees: repos });
  return { repos, service };
}

describe('EmployeeDomainService.create', () => {
  it('creates a proposed employee and persists it', async () => {
    const { repos, service } = build();
    const result = await service.create(
      { organizationId: TENANT, name: 'Sarah Chen' },
      userContext(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.employee.status.value).toBe('proposed');
      expect(result.value.events.map((event) => event.type)).toEqual(['employee.created']);
      expect(repos.employees.has(result.value.employee.id)).toBe(true);
    }
  });

  it('rejects an empty name with a validation error (no save)', async () => {
    const { repos, service } = build();
    const result = await service.create({ organizationId: TENANT, name: ' ' }, userContext());
    expect(result.ok).toBe(false);
    expect(repos.employees.size).toBe(0);
  });
});

describe('EmployeeDomainService.activate', () => {
  it('activates only through the legal chain (proposed → active is rejected)', async () => {
    const { repos, service } = build();
    const created = await service.create({ organizationId: TENANT, name: 'Sarah' }, userContext());
    if (!created.ok) return;
    // proposed → active directly is illegal.
    const direct = await service.activate(created.value.employee.id, userContext());
    expect(direct.ok).toBe(false);
    // But the full chain reaches active.
    const hired = await service.hire(created.value.employee.id, userContext());
    expect(hired.ok).toBe(true);
    const onboarded = await service.onboard(created.value.employee.id, userContext());
    expect(onboarded.ok).toBe(true);
    const activated = await service.activate(created.value.employee.id, userContext());
    expect(activated.ok).toBe(true);
    if (activated.ok) {
      expect(activated.value.employee.isActive()).toBe(true);
      repos.employees.set(activated.value.employee.id, activated.value.employee);
    }
  });

  it('returns a not-found error for unknown ids', async () => {
    const { service } = build();
    const result = await service.activate(
      'emp_00000000-0000-4000-8000-000000000000' as EmployeeId,
      userContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(EmployeeNotFoundError);
    }
  });
});

describe('EmployeeDomainService.findByName (resolution)', () => {
  it('returns the single exact employee (resolved)', async () => {
    const { repos, service } = build();
    await seedActiveEmployee(service, repos, 'Sarah Chen');
    await seedActiveEmployee(service, repos, 'Sam Lee');

    const result = await service.findByName(TENANT, 'Sarah');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.name.value).toBe('Sarah Chen');
    }
  });

  it('returns multiple candidates when the name is ambiguous (no guessing)', async () => {
    const { repos, service } = build();
    await seedActiveEmployee(service, repos, 'Sarah Chen');
    await seedActiveEmployee(service, repos, 'Sarah Kim');

    const result = await service.findByName(TENANT, 'Sarah');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((employee) => employee.name.value).sort()).toEqual([
        'Sarah Chen',
        'Sarah Kim',
      ]);
    }
  });

  it('returns no candidates for an unknown name', async () => {
    const { repos, service } = build();
    await seedActiveEmployee(service, repos, 'Sarah Chen');
    const result = await service.findByName(TENANT, 'Nobody');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('is tenant-scoped (never leaks employees of another organization)', async () => {
    const { repos, service } = build();
    await seedActiveEmployee(service, repos, 'Sarah Chen');
    await seedActiveEmployee(service, repos, 'Sarah Kim', 'org_alien' as TenantId);

    const result = await service.findByName(TENANT, 'Sarah');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((employee) => employee.name.value)).toEqual(['Sarah Chen']);
    }
  });
});

describe('EmployeeDomainService.listByOrganization', () => {
  it('lists only the tenant’s employees', async () => {
    const { repos, service } = build();
    await seedActiveEmployee(service, repos, 'Sarah Chen');
    await seedActiveEmployee(service, repos, 'Sam Lee');
    await seedActiveEmployee(service, repos, 'Alien', 'org_alien' as TenantId);

    const result = await service.listByOrganization(TENANT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((employee) => employee.name.value).sort()).toEqual([
        'Sam Lee',
        'Sarah Chen',
      ]);
    }
  });
});
