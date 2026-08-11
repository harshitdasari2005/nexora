/**
 * Projects value-object tests: validation rules of ProjectName,
 * ProjectDescription, ProjectStatus, and ProjectId.
 */

import { describe, expect, it } from 'vitest';

import {
  InvalidProjectValueError,
  ProjectDescription,
  ProjectId,
  ProjectName,
  ProjectStatus,
} from '../src/index.js';

describe('ProjectName', () => {
  it('accepts a normal trimmed name', () => {
    expect(ProjectName.create('  Mobile Banking  ').value).toBe('Mobile Banking');
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(() => ProjectName.create('   ')).toThrow(InvalidProjectValueError);
    expect(() => ProjectName.create('')).toThrow(InvalidProjectValueError);
  });

  it('rejects a name over the platform limit', () => {
    expect(() => ProjectName.create('x'.repeat(121))).toThrow(InvalidProjectValueError);
  });

  it('accepts a name at the platform limit', () => {
    expect(ProjectName.create('x'.repeat(120)).value).toHaveLength(120);
  });

  it('compares structurally with equals', () => {
    expect(ProjectName.create('Payroll').equals(ProjectName.create('Payroll'))).toBe(true);
    expect(ProjectName.create('Payroll').equals(ProjectName.create('HR'))).toBe(false);
  });

  it('stringifies to the value', () => {
    expect(String(ProjectName.create('Payroll'))).toBe('Payroll');
  });
});

describe('ProjectDescription', () => {
  it('is absent for undefined input', () => {
    const description = ProjectDescription.create(undefined);
    expect(description.value).toBeUndefined();
    expect(description.isPresent).toBe(false);
  });

  it('is absent for whitespace-only input', () => {
    expect(ProjectDescription.create('   ').value).toBeUndefined();
  });

  it('trims a real description', () => {
    const description = ProjectDescription.create('  Core banking app  ');
    expect(description.value).toBe('Core banking app');
    expect(description.isPresent).toBe(true);
  });

  it('rejects a description over the bound', () => {
    expect(() => ProjectDescription.create('x'.repeat(2001))).toThrow(InvalidProjectValueError);
  });

  it('accepts a description at the bound', () => {
    expect(ProjectDescription.create('x'.repeat(2000)).value).toHaveLength(2000);
  });
});

describe('ProjectStatus', () => {
  it('exposes every lifecycle status', () => {
    expect(ProjectStatus.proposed().value).toBe('proposed');
    expect(ProjectStatus.active().value).toBe('active');
    expect(ProjectStatus.onHold().value).toBe('on_hold');
    expect(ProjectStatus.completed().value).toBe('completed');
    expect(ProjectStatus.archived().value).toBe('archived');
    expect(ProjectStatus.cancelled().value).toBe('cancelled');
  });

  it('reconstructs from a stored value', () => {
    expect(ProjectStatus.from('on_hold').value).toBe('on_hold');
  });

  it('rejects an unknown status', () => {
    expect(() => ProjectStatus.from('paused')).toThrow(InvalidProjectValueError);
  });

  it('reports active and terminal predicates', () => {
    expect(ProjectStatus.active().isActive()).toBe(true);
    expect(ProjectStatus.onHold().isActive()).toBe(false);
    expect(ProjectStatus.archived().isTerminal()).toBe(true);
    expect(ProjectStatus.cancelled().isTerminal()).toBe(true);
    expect(ProjectStatus.completed().isTerminal()).toBe(false);
  });
});

describe('ProjectId', () => {
  it('generates `prj_`-prefixed ids', () => {
    expect(ProjectId.create()).toMatch(/^prj_[0-9a-f-]{36}$/);
  });

  it('generates unique ids', () => {
    expect(ProjectId.create()).not.toBe(ProjectId.create());
  });

  it('reconstructs a valid id', () => {
    const id = ProjectId.create();
    expect(ProjectId.from(id)).toBe(id);
  });

  it('rejects a malformed id', () => {
    expect(() => ProjectId.from('wsp_bogus')).toThrow(InvalidProjectValueError);
    expect(() => ProjectId.from('project-123')).toThrow(InvalidProjectValueError);
  });
});
