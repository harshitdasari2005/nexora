/**
 * Projects domain error tests: the error hierarchy extends the shared
 * `NexoraError` vocabulary with canonical codes (API_CONTRACTS.md §10), and
 * `toProjectError` maps shared ValidationErrors and raw errors onto the
 * Projects domain family.
 */

import { describe, expect, it } from 'vitest';
import { NexoraError, ValidationError } from '@nexora/shared/errors';

import {
  InvalidProjectValueError,
  ProjectArchivedError,
  ProjectCancelledError,
  ProjectDomainError,
  ProjectNotFoundError,
  ProjectStateTransitionError,
  toProjectError,
} from '../src/index.js';

describe('Projects domain errors', () => {
  it('all extend the shared NexoraError hierarchy', () => {
    expect(new ProjectDomainError('boom')).toBeInstanceOf(NexoraError);
    expect(new InvalidProjectValueError('bad', [])).toBeInstanceOf(NexoraError);
    expect(new ProjectNotFoundError()).toBeInstanceOf(NexoraError);
    expect(new ProjectStateTransitionError('nope')).toBeInstanceOf(NexoraError);
    expect(new ProjectArchivedError()).toBeInstanceOf(NexoraError);
    expect(new ProjectCancelledError()).toBeInstanceOf(NexoraError);
  });

  it('carries canonical error codes', () => {
    expect(new InvalidProjectValueError('bad', []).code).toBe('VALIDATION_ERROR');
    expect(new ProjectNotFoundError().code).toBe('NOT_FOUND');
    expect(new ProjectStateTransitionError('nope').code).toBe('BUSINESS_RULE_VIOLATION');
    expect(new ProjectArchivedError().code).toBe('BUSINESS_RULE_VIOLATION');
    expect(new ProjectCancelledError().code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('InvalidProjectValueError carries field issues', () => {
    const error = new InvalidProjectValueError('bad', [
      { path: 'name', message: 'Must not be empty' },
    ]);
    expect(error.issues).toEqual([{ path: 'name', message: 'Must not be empty' }]);
  });

  it('ProjectDomainError defaults to BUSINESS_RULE_VIOLATION', () => {
    expect(new ProjectDomainError('boom').code).toBe('BUSINESS_RULE_VIOLATION');
  });
});

describe('toProjectError', () => {
  it('passes through Projects domain errors unchanged', () => {
    const error = new ProjectNotFoundError();
    expect(toProjectError(error)).toBe(error);
  });

  it('maps shared ValidationError to InvalidProjectValueError', () => {
    const error = new ValidationError('bad input', [{ path: 'name', message: 'Empty' }]);
    const mapped = toProjectError(error);
    expect(mapped).toBeInstanceOf(InvalidProjectValueError);
    expect(mapped.code).toBe('VALIDATION_ERROR');
    expect((mapped as InvalidProjectValueError).issues).toEqual([
      { path: 'name', message: 'Empty' },
    ]);
  });

  it('maps a raw Error to an internal ProjectDomainError', () => {
    const mapped = toProjectError(new Error('db down'));
    expect(mapped).toBeInstanceOf(ProjectDomainError);
    expect(mapped.code).toBe('INTERNAL_ERROR');
    expect(mapped.message).toBe('db down');
  });

  it('maps a non-error value to an internal ProjectDomainError', () => {
    expect(toProjectError('oops').code).toBe('INTERNAL_ERROR');
  });
});
