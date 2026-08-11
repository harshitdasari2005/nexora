/**
 * HR domain error tests: the canonical code taxonomy and `toHrError` mapping
 * (API_CONTRACTS.md §10).
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@nexora/shared/errors';

import {
  EmployeeNotFoundError,
  EmployeeStateTransitionError,
  HrDomainError,
  InvalidEmployeeValueError,
  toHrError,
} from '../src/index.js';

describe('HR domain errors', () => {
  it('carries canonical error codes', () => {
    expect(new InvalidEmployeeValueError('bad', []).code).toBe('VALIDATION_ERROR');
    expect(new EmployeeNotFoundError().code).toBe('NOT_FOUND');
    expect(new EmployeeStateTransitionError('no').code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('extends the shared NexoraError family (instanceof HrDomainError)', () => {
    const error = new EmployeeNotFoundError();
    expect(error).toBeInstanceOf(HrDomainError);
  });

  it('toHrError passes through HR errors unchanged', () => {
    const error = new EmployeeNotFoundError();
    expect(toHrError(error)).toBe(error);
  });

  it('toHrError maps shared ValidationErrors onto the HR vocabulary', () => {
    const validation = new ValidationError('bad name', [{ path: 'name', message: 'Empty' }]);
    const mapped = toHrError(validation);
    expect(mapped).toBeInstanceOf(InvalidEmployeeValueError);
    expect(mapped.code).toBe('VALIDATION_ERROR');
  });

  it('toHrError wraps unknown errors as internal', () => {
    const mapped = toHrError(new Error('boom'));
    expect(mapped).toBeInstanceOf(HrDomainError);
    expect(mapped.code).toBe('INTERNAL_ERROR');
  });
});
