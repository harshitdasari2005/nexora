/**
 * HR policy tests: lifecycle transition table and value invariants
 * (DOMAIN_MODEL.md §14.1).
 */

import { describe, expect, it } from 'vitest';

import {
  EmployeeLifecyclePolicy,
  EmployeeStateTransitionError,
  EmployeeStatus,
  EmployeeValuePolicy,
  EMPLOYEE_TRANSITIONS,
  InvalidEmployeeValueError,
} from '../src/index.js';

const lifecycle = new EmployeeLifecyclePolicy();

describe('EMPLOYEE_TRANSITIONS (DOMAIN_MODEL.md §14.1)', () => {
  it('defines the full lifecycle table', () => {
    expect(EMPLOYEE_TRANSITIONS.proposed).toEqual(['hired', 'cancelled']);
    expect(EMPLOYEE_TRANSITIONS.hired).toEqual(['onboarding']);
    expect(EMPLOYEE_TRANSITIONS.onboarding).toEqual(['active']);
    expect(EMPLOYEE_TRANSITIONS.active).toEqual(['on_leave', 'exiting']);
    expect(EMPLOYEE_TRANSITIONS.on_leave).toEqual(['active', 'exiting']);
    expect(EMPLOYEE_TRANSITIONS.exiting).toEqual(['offboarded']);
    expect(EMPLOYEE_TRANSITIONS.offboarded).toEqual([]);
    expect(EMPLOYEE_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe('EmployeeLifecyclePolicy', () => {
  it('allows the legal forward transitions', () => {
    expect(() =>
      lifecycle.assertCanTransition(EmployeeStatus.proposed(), EmployeeStatus.hired()),
    ).not.toThrow();
    expect(() =>
      lifecycle.assertCanTransition(EmployeeStatus.hired(), EmployeeStatus.onboarding()),
    ).not.toThrow();
    expect(() =>
      lifecycle.assertCanTransition(EmployeeStatus.onboarding(), EmployeeStatus.active()),
    ).not.toThrow();
    expect(() =>
      lifecycle.assertCanTransition(EmployeeStatus.active(), EmployeeStatus.onLeave()),
    ).not.toThrow();
    expect(() =>
      lifecycle.assertCanTransition(EmployeeStatus.onLeave(), EmployeeStatus.active()),
    ).not.toThrow();
  });

  it('rejects illegal transitions', () => {
    expect(() =>
      lifecycle.assertCanTransition(EmployeeStatus.proposed(), EmployeeStatus.active()),
    ).toThrow(EmployeeStateTransitionError);
    expect(() =>
      lifecycle.assertCanTransition(EmployeeStatus.hired(), EmployeeStatus.cancelled()),
    ).toThrow(EmployeeStateTransitionError);
    expect(() =>
      lifecycle.assertCanTransition(EmployeeStatus.offboarded(), EmployeeStatus.active()),
    ).toThrow(EmployeeStateTransitionError);
    expect(() =>
      lifecycle.assertCanTransition(EmployeeStatus.cancelled(), EmployeeStatus.hired()),
    ).toThrow(EmployeeStateTransitionError);
  });

  it('rejects transitions from terminal states', () => {
    expect(lifecycle.allowedTargets(EmployeeStatus.offboarded())).toEqual([]);
    expect(lifecycle.allowedTargets(EmployeeStatus.cancelled())).toEqual([]);
  });
});

describe('EmployeeValuePolicy', () => {
  const values = new EmployeeValuePolicy();

  it('accepts a valid name', () => {
    expect(() => values.assertValidName('Sarah Chen')).not.toThrow();
  });

  it('rejects empty names', () => {
    expect(() => values.assertValidName('  ')).toThrow(InvalidEmployeeValueError);
  });

  it('rejects over-long names', () => {
    expect(() => values.assertValidName('x'.repeat(121))).toThrow(InvalidEmployeeValueError);
  });
});
