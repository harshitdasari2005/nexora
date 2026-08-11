/**
 * HR value object tests: EmployeeId, EmployeeName, EmployeeStatus.
 */

import { describe, expect, it } from 'vitest';

import {
  EmployeeId,
  EmployeeName,
  EmployeeStatus,
  InvalidEmployeeValueError,
} from '../src/index.js';

describe('EmployeeId', () => {
  it('generates prefixed unique ids', () => {
    const id = EmployeeId.create();
    expect(id).toMatch(/^emp_[0-9a-f-]{36}$/);
    expect(EmployeeId.create()).not.toBe(id);
  });

  it('reconstructs a stored id', () => {
    const id = EmployeeId.create();
    expect(EmployeeId.from(id)).toBe(id);
  });

  it('rejects malformed ids', () => {
    expect(() => EmployeeId.from('prj_123')).toThrow(InvalidEmployeeValueError);
    expect(() => EmployeeId.from('emp_123')).toThrow(InvalidEmployeeValueError);
  });
});

describe('EmployeeName', () => {
  it('trims and normalizes', () => {
    expect(EmployeeName.create('  Sarah Chen  ').value).toBe('Sarah Chen');
  });

  it('rejects empty names', () => {
    expect(() => EmployeeName.create('   ')).toThrow(InvalidEmployeeValueError);
  });

  it('rejects over-long names', () => {
    expect(() => EmployeeName.create('x'.repeat(121))).toThrow(InvalidEmployeeValueError);
  });

  it('supports structural equality', () => {
    expect(EmployeeName.create('Sarah').equals(EmployeeName.create('Sarah'))).toBe(true);
    expect(EmployeeName.create('Sarah').equals(EmployeeName.create('Sam'))).toBe(false);
  });
});

describe('EmployeeStatus', () => {
  it('exposes every lifecycle factory', () => {
    expect(EmployeeStatus.proposed().value).toBe('proposed');
    expect(EmployeeStatus.hired().value).toBe('hired');
    expect(EmployeeStatus.onboarding().value).toBe('onboarding');
    expect(EmployeeStatus.active().value).toBe('active');
    expect(EmployeeStatus.onLeave().value).toBe('on_leave');
    expect(EmployeeStatus.exiting().value).toBe('exiting');
    expect(EmployeeStatus.offboarded().value).toBe('offboarded');
    expect(EmployeeStatus.cancelled().value).toBe('cancelled');
  });

  it('reconstructs from a stored value', () => {
    expect(EmployeeStatus.from('active').value).toBe('active');
    expect(EmployeeStatus.from('on_leave').value).toBe('on_leave');
  });

  it('rejects unknown statuses', () => {
    expect(() => EmployeeStatus.from('employed')).toThrow(InvalidEmployeeValueError);
  });

  it('isActive is true only for active', () => {
    expect(EmployeeStatus.active().isActive()).toBe(true);
    expect(EmployeeStatus.proposed().isActive()).toBe(false);
    expect(EmployeeStatus.onLeave().isActive()).toBe(false);
  });

  it('terminal statuses are detected', () => {
    expect(EmployeeStatus.offboarded().isTerminal()).toBe(true);
    expect(EmployeeStatus.cancelled().isTerminal()).toBe(true);
    expect(EmployeeStatus.active().isTerminal()).toBe(false);
  });
});
