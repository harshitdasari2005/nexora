/**
 * Error hierarchy tests: canonical codes and domain base class.
 */

import { describe, expect, it } from 'vitest';

import { NexoraError } from '@nexora/shared/errors';

import {
  IdentityDomainError,
  isIdentityDomainError,
  toIdentityError,
  UserAlreadyExistsError,
  UserNotFoundError,
  InvalidIdentityValueError,
} from '../src/errors/index.js';

describe('IdentityDomainError hierarchy', () => {
  it('extends the shared NexoraError hierarchy', () => {
    const error = new IdentityDomainError('boom');
    expect(error).toBeInstanceOf(NexoraError);
    expect(error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('carries canonical codes', () => {
    expect(new UserNotFoundError().code).toBe('NOT_FOUND');
    expect(new UserAlreadyExistsError().code).toBe('CONFLICT');
    expect(new InvalidIdentityValueError('bad', []).code).toBe('VALIDATION_ERROR');
  });

  it('isIdentityDomainError narrows the family', () => {
    expect(isIdentityDomainError(new UserNotFoundError())).toBe(true);
    expect(isIdentityDomainError(new Error('plain'))).toBe(false);
  });

  it('toIdentityError passes IdentityDomainError through unchanged', () => {
    const error = new UserNotFoundError();
    expect(toIdentityError(error)).toBe(error);
  });

  it('toIdentityError wraps a shared ValidationError into InvalidIdentityValueError', () => {
    const wrapped = toIdentityError(
      new InvalidIdentityValueError('bad', [{ path: 'x', message: 'y' }]),
    );
    expect(wrapped).toBeInstanceOf(InvalidIdentityValueError);
    expect(wrapped.code).toBe('VALIDATION_ERROR');
  });

  it('toIdentityError wraps a plain Error as INTERNAL_ERROR', () => {
    const wrapped = toIdentityError(new Error('raw'));
    expect(wrapped).toBeInstanceOf(IdentityDomainError);
    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.message).toBe('raw');
  });

  it('toIdentityError handles non-errors', () => {
    const wrapped = toIdentityError('string failure');
    expect(wrapped.code).toBe('INTERNAL_ERROR');
  });
});
