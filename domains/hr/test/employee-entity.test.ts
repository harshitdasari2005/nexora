/**
 * Employee aggregate tests: creation, guarded lifecycle transitions, event
 * recording, snapshot/hydrate round-trips (DOMAIN_MODEL.md §14.1).
 */

import { describe, expect, it } from 'vitest';

import { Employee, EmployeeStateTransitionError } from '../src/index.js';
import { TENANT, userContext } from './helpers.js';

/** Creates a proposed employee with events pulled (ready for mutations). */
function proposedEmployee(): Employee {
  const employee = Employee.create({ organizationId: TENANT, name: 'Sarah Chen' }, userContext());
  employee.pullDomainEvents();
  return employee;
}

describe('Employee.create', () => {
  it('creates a proposed employee with a valid id and name', () => {
    const employee = Employee.create(
      { organizationId: TENANT, name: '  Sarah Chen  ' },
      userContext(),
    );
    expect(employee.id).toMatch(/^emp_/);
    expect(employee.organizationId).toBe(TENANT);
    expect(employee.name.value).toBe('Sarah Chen');
    expect(employee.status.value).toBe('proposed');
    expect(employee.version).toBe(1);
    expect(employee.isActive()).toBe(false);
  });

  it('records a single employee.created event with context', () => {
    const context = userContext('usr_alex', TENANT, 'corr_1');
    const employee = Employee.create({ organizationId: TENANT, name: 'Sarah' }, context);
    const events = employee.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('employee.created');
    expect(events[0]?.correlationId).toBe('corr_1');
    expect(events[0]?.tenantId).toBe(TENANT);
    expect((events[0]?.payload as { name: string }).name).toBe('Sarah');
  });

  it('rejects an empty name before any state exists (no partial aggregate)', () => {
    expect(() => Employee.create({ organizationId: TENANT, name: '   ' }, userContext())).toThrow();
  });
});

describe('Employee lifecycle transitions', () => {
  it('walks the forward chain proposed → hired → onboarding → active', () => {
    const employee = proposedEmployee();
    employee.hire(userContext());
    expect(employee.status.value).toBe('hired');
    employee.onboard(userContext());
    expect(employee.status.value).toBe('onboarding');
    employee.activate(userContext());
    expect(employee.status.value).toBe('active');
    expect(employee.isActive()).toBe(true);
    // Each transition bumps the version.
    expect(employee.version).toBe(4);
  });

  it('records a single activation event when reaching active', () => {
    const employee = proposedEmployee();
    employee.hire(userContext());
    employee.onboard(userContext());
    employee.activate(userContext());
    const events = employee.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['employee.activated']);
  });

  it('cannot skip lifecycle steps (proposed → active is illegal)', () => {
    const employee = proposedEmployee();
    expect(() => employee.activate(userContext())).toThrow(EmployeeStateTransitionError);
    expect(employee.status.value).toBe('proposed');
  });

  it('cannot hire twice', () => {
    const employee = proposedEmployee();
    employee.hire(userContext());
    expect(() => employee.hire(userContext())).toThrow(EmployeeStateTransitionError);
  });

  it('cannot mutate a cancelled employee', () => {
    const employee = proposedEmployee();
    employee.cancel(userContext());
    expect(employee.status.value).toBe('cancelled');
    expect(() => employee.hire(userContext())).toThrow(EmployeeStateTransitionError);
  });

  it('no partial mutation on a failed transition (status and version unchanged)', () => {
    const employee = proposedEmployee();
    const before = employee.version;
    expect(() => employee.cancel(userContext())).not.toThrow();
    expect(employee.status.value).toBe('cancelled');
    expect(employee.version).toBe(before + 1);
    // A second illegal transition must not mutate.
    const versionAfterCancel = employee.version;
    expect(() => employee.hire(userContext())).toThrow(EmployeeStateTransitionError);
    expect(employee.version).toBe(versionAfterCancel);
    expect(employee.status.value).toBe('cancelled');
  });
});

describe('Employee snapshot / hydrate', () => {
  it('round-trips through snapshot and hydrate without re-emitting events', () => {
    const employee = proposedEmployee();
    employee.hire(userContext());
    employee.onboard(userContext());
    employee.activate(userContext());
    const snapshot = Employee.snapshot(employee);

    const restored = Employee.hydrate(snapshot);
    expect(restored.id).toBe(employee.id);
    expect(restored.organizationId).toBe(employee.organizationId);
    expect(restored.name.value).toBe(employee.name.value);
    expect(restored.status.value).toBe('active');
    expect(restored.version).toBe(employee.version);
    expect(restored.pullDomainEvents()).toEqual([]);
  });

  it('hydrate re-validates values at load', () => {
    const employee = proposedEmployee();
    expect(() =>
      Employee.hydrate({
        ...Employee.snapshot(employee),
        name: 'x'.repeat(121),
      }),
    ).toThrow();
  });
});
