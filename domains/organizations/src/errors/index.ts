/**
 * @nexora/domain-organizations — domain errors.
 *
 * The Organizations bounded context error vocabulary (DOMAIN_MODEL.md §1
 * Tenancy). Every error extends the shared `NexoraError` hierarchy so codes
 * stay canonical (API_CONTRACTS.md §10 taxonomy) and cross-boundary error
 * handling works unchanged (ENGINEERING_PLAYBOOK.md §4.2).
 */

import { NexoraError, ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';

/**
 * Base class for every Organizations domain error. All concrete errors extend
 * this so services can catch the whole bounded-context family with one
 * `instanceof` check.
 */
export class OrganizationDomainError extends NexoraError {
  /**
   * @param message - human-readable message.
   * @param code    - canonical error code (API_CONTRACTS.md §10).
   * @param details - optional structured details.
   * @param cause   - optional originating error.
   */
  constructor(
    message: string,
    code: ErrorCode = 'BUSINESS_RULE_VIOLATION',
    details?: unknown,
    cause?: unknown,
  ) {
    super(message, code, details, cause);
  }
}

/**
 * A value object or entity rejected its input during construction (malformed
 * slug, invalid name, ...). Carries field issues and the canonical
 * `VALIDATION_ERROR` code. `toOrganizationError` maps shared
 * {@link ValidationError}s onto this type so callers see one validation error
 * family.
 */
export class InvalidOrganizationValueError extends OrganizationDomainError {
  /** The field issues that failed. */
  readonly issues: readonly FieldIssue[];

  constructor(message: string, issues: readonly FieldIssue[], details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.issues = issues;
  }
}

/** The organization does not exist (or is not visible to the caller). */
export class OrganizationNotFoundError extends OrganizationDomainError {
  constructor(details?: unknown) {
    super('Organization not found', 'NOT_FOUND', details);
  }
}

/** An organization with the same slug already exists (slug is unique). */
export class SlugAlreadyExistsError extends OrganizationDomainError {
  constructor(details?: unknown) {
    super('Organization slug already exists', 'CONFLICT', details);
  }
}

/** An organization lifecycle transition was attempted that the policy forbids. */
export class OrganizationStateTransitionError extends OrganizationDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The organization is not in an active state and cannot perform the action. */
export class OrganizationNotActiveError extends OrganizationDomainError {
  constructor(details?: unknown) {
    super('Organization is not active', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The organization is archived and rejects mutations. */
export class OrganizationArchivedError extends OrganizationDomainError {
  constructor(details?: unknown) {
    super('Organization is archived', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The membership does not exist in the organization. */
export class MemberNotFoundError extends OrganizationDomainError {
  constructor(details?: unknown) {
    super('Membership not found', 'NOT_FOUND', details);
  }
}

/** The user is already a member of the organization. */
export class MemberAlreadyExistsError extends OrganizationDomainError {
  constructor(details?: unknown) {
    super('User is already a member', 'CONFLICT', details);
  }
}

/** The last owner of an organization cannot be removed or demoted. */
export class LastOwnerRemovalError extends OrganizationDomainError {
  constructor(details?: unknown) {
    super('An organization must retain at least one owner', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** Type guard: true when the value is any Organizations domain error. */
export function isOrganizationDomainError(value: unknown): value is OrganizationDomainError {
  return value instanceof OrganizationDomainError;
}

/**
 * Maps an unknown thrown value to an {@link OrganizationDomainError}.
 * Organization errors and shared {@link ValidationError}s pass through
 * unchanged; anything else is wrapped so services can consistently return
 * `Result<T, OrganizationDomainError>`.
 */
export function toOrganizationError(error: unknown): OrganizationDomainError {
  if (error instanceof OrganizationDomainError) {
    return error;
  }
  if (error instanceof ValidationError) {
    return new InvalidOrganizationValueError(error.message, error.issues, error.details);
  }
  if (error instanceof Error) {
    return new OrganizationDomainError(error.message, 'INTERNAL_ERROR', undefined, error);
  }
  return new OrganizationDomainError(String(error), 'INTERNAL_ERROR');
}
