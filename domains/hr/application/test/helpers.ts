/**
 * Shared test helpers for the HR application layer tests: an in-memory
 * {@link EmployeeRepository} fake and a recording {@link EventPublisher}.
 */

import type { TenantId } from '@nexora/contracts/common';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import { EmployeeDomainService, type Employee, type EmployeeRepository } from '@nexora/domain-hr';

/** The default test tenant. */
export const TENANT = 'org_acme' as TenantId;

/** An in-memory {@link EmployeeRepository} (test fake). */
export class FakeEmployeeRepository implements EmployeeRepository {
  readonly employees = new Map<string, Employee>();

  async findById(id: Employee['id']): Promise<Employee | undefined> {
    return this.employees.get(id);
  }

  async findByName(organizationId: TenantId, name: string): Promise<readonly Employee[]> {
    const term = name.trim().toLowerCase();
    return [...this.employees.values()].filter(
      (employee) =>
        employee.organizationId === organizationId &&
        employee.name.value.toLowerCase().includes(term),
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

/** A recording {@link EventPublisher} (assert what was published). */
export class RecordingEventPublisher implements EventPublisher {
  readonly published: EventEnvelope[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    this.published.push(...events);
  }
}

/** Builds a domain service over a fresh fake repository. */
export function domainService(
  repository: FakeEmployeeRepository = new FakeEmployeeRepository(),
): EmployeeDomainService {
  return new EmployeeDomainService({ employees: repository });
}
