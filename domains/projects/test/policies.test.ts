/**
 * Projects lifecycle policy tests: the DOMAIN_MODEL.md §14.2 transition
 * table is the single authoritative definition, and every legal / illegal
 * transition is asserted here.
 */

import { describe, expect, it } from 'vitest';

import {
  InvalidProjectValueError,
  PROJECT_TRANSITIONS,
  ProjectLifecyclePolicy,
  ProjectStateTransitionError,
  ProjectStatus,
  ProjectValuePolicy,
} from '../src/index.js';

const policy = new ProjectLifecyclePolicy();

describe('PROJECT_TRANSITIONS (DOMAIN_MODEL.md §14.2)', () => {
  it('proposed → active (charter approved, WRK-4) and proposed → cancelled', () => {
    expect(PROJECT_TRANSITIONS.proposed).toEqual(['active', 'cancelled']);
  });

  it('active → on_hold, completed (owner closes, EVT-9), cancelled (owner + approval)', () => {
    expect(PROJECT_TRANSITIONS.active).toEqual(['on_hold', 'completed', 'cancelled']);
  });

  it('on_hold → active (resume)', () => {
    expect(PROJECT_TRANSITIONS.on_hold).toEqual(['active']);
  });

  it('completed → archived (retention policy)', () => {
    expect(PROJECT_TRANSITIONS.completed).toEqual(['archived']);
  });

  it('archived and cancelled are terminal', () => {
    expect(PROJECT_TRANSITIONS.archived).toEqual([]);
    expect(PROJECT_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe('ProjectLifecyclePolicy', () => {
  it('asserts a legal transition silently', () => {
    expect(() =>
      policy.assertCanTransition(ProjectStatus.proposed(), ProjectStatus.active()),
    ).not.toThrow();
  });

  it('rejects an illegal transition with a typed error', () => {
    expect(() =>
      policy.assertCanTransition(ProjectStatus.proposed(), ProjectStatus.completed()),
    ).toThrow(ProjectStateTransitionError);
    expect(() =>
      policy.assertCanTransition(ProjectStatus.archived(), ProjectStatus.active()),
    ).toThrow(ProjectStateTransitionError);
    expect(() =>
      policy.assertCanTransition(ProjectStatus.cancelled(), ProjectStatus.onHold()),
    ).toThrow(ProjectStateTransitionError);
    expect(() =>
      policy.assertCanTransition(ProjectStatus.completed(), ProjectStatus.active()),
    ).toThrow(ProjectStateTransitionError);
  });

  it('reports the allowed targets of a status', () => {
    expect(policy.allowedTargets(ProjectStatus.active())).toEqual([
      'on_hold',
      'completed',
      'cancelled',
    ]);
  });
});

describe('ProjectValuePolicy', () => {
  it('asserts a valid name silently', () => {
    expect(() => new ProjectValuePolicy().assertValidName('Mobile Banking')).not.toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => new ProjectValuePolicy().assertValidName('   ')).toThrow(InvalidProjectValueError);
  });

  it('rejects an over-long name', () => {
    expect(() => new ProjectValuePolicy().assertValidName('x'.repeat(81), 80)).toThrow(
      InvalidProjectValueError,
    );
  });

  it('asserts a valid description silently', () => {
    expect(() => new ProjectValuePolicy().assertValidDescription('Core banking app')).not.toThrow();
    expect(() => new ProjectValuePolicy().assertValidDescription(undefined)).not.toThrow();
  });

  it('rejects an over-long description', () => {
    expect(() => new ProjectValuePolicy().assertValidDescription('x'.repeat(2001))).toThrow(
      InvalidProjectValueError,
    );
  });
});
