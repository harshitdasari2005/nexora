/**
 * Organization error hierarchy tests: canonical codes, subclassing, and the
 * toOrganizationError mapping.
 */

import { describe, expect, it } from 'vitest';
import { NexoraError, ValidationError } from '@nexora/shared/errors';

import {
  InvalidOrganizationValueError,
  isOrganizationDomainError,
  LastOwnerRemovalError,
  MemberAlreadyExistsError,
  MemberNotFoundError,
  OrganizationArchivedError,
  OrganizationDomainError,
  OrganizationNotFoundError,
  OrganizationNotActiveError,
  OrganizationStateTransitionError,
  SlugAlreadyExistsError,
  toOrganizationError,
} from '../src/errors/index.js';

describe('OrganizationDomainError hierarchy', () => {
  it('extends the shared NexoraError hierarchy', () => {
    expect(new OrganizationDomainError('boom') instanceof NexoraError).toBe(true);
  });

  it('defaults to the business-rule code', () => {
    expect(new OrganizationDomainError('boom').code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('assigns canonical codes to each error', () => {
    expect(new OrganizationNotFoundError().code).toBe('NOT_FOUND');
    expect(new SlugAlreadyExistsError().code).toBe('CONFLICT');
    expect(new MemberNotFoundError().code).toBe('NOT_FOUND');
    expect(new MemberAlreadyExistsError().code).toBe('CONFLICT');
    expect(new OrganizationNotActiveError().code).toBe('BUSINESS_RULE_VIOLATION');
    expect(new OrganizationArchivedError().code).toBe('BUSINESS_RULE_VIOLATION');
    expect(new OrganizationStateTransitionError('x').code).toBe('BUSINESS_RULE_VIOLATION');
    expect(new LastOwnerRemovalError().code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('InvalidOrganizationValueError carries the canonical validation code and issues', () => {
    const error = new InvalidOrganizationValueError('Invalid slug', [
      { path: 'slug', message: 'bad' },
    ]);
    expect(error instanceof OrganizationDomainError).toBe(true);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.issues).toEqual([{ path: 'slug', message: 'bad' }]);
  });
});

describe('isOrganizationDomainError', () => {
  it('narrows organization errors', () => {
    expect(isOrganizationDomainError(new OrganizationNotFoundError())).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isOrganizationDomainError(new Error('x'))).toBe(false);
    expect(isOrganizationDomainError('string')).toBe(false);
    expect(isOrganizationDomainError(undefined)).toBe(false);
  });
});

describe('toOrganizationError', () => {
  it('passes organization errors through unchanged', () => {
    const error = new OrganizationNotFoundError({ organizationId: 'org_1' });
    expect(toOrganizationError(error)).toBe(error);
  });

  it('maps shared ValidationError into InvalidOrganizationValueError', () => {
    const validation = new ValidationError('bad', [{ path: 'slug', message: 'no' }]);
    const mapped = toOrganizationError(validation) as InvalidOrganizationValueError;
    expect(mapped).toBeInstanceOf(InvalidOrganizationValueError);
    expect(mapped.issues).toEqual([{ path: 'slug', message: 'no' }]);
  });

  it('wraps plain errors as INTERNAL_ERROR', () => {
    const mapped = toOrganizationError(new Error('db down'));
    expect(mapped).toBeInstanceOf(OrganizationDomainError);
    expect(mapped.code).toBe('INTERNAL_ERROR');
  });

  it('wraps non-error values', () => {
    expect(toOrganizationError('boom').code).toBe('INTERNAL_ERROR');
    expect(toOrganizationError(undefined).code).toBe('INTERNAL_ERROR');
  });
});
