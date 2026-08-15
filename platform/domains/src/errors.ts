/**
 * @nexora/module-domains — domain definition errors.
 *
 * The Domain → Role → Capability registry error vocabulary (S24 Phase 1;
 * API_CONTRACTS.md §10 taxonomy). Every error extends the shared
 * {@link NexoraError} hierarchy so codes stay canonical and cross-boundary
 * error handling works unchanged (ENGINEERING_PLAYBOOK.md §4.2). These
 * errors are raised at REGISTRATION time — configuration is validated when
 * definitions are registered, never discovered mid-request.
 */

import { NexoraError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';

/** The kind of definition an error refers to. */
export type DefinitionKind = 'domain' | 'role' | 'capability' | 'catalog';

/**
 * Base class for every domain-definition error. All concrete errors extend
 * this so callers can catch the whole family with one `instanceof` check.
 */
export class DomainDefinitionError extends NexoraError {
  constructor(
    message: string,
    code: ErrorCode = 'VALIDATION_ERROR',
    details?: unknown,
    cause?: unknown,
  ) {
    super(message, code, details, cause);
  }
}

/** A definition id was registered more than once (S24 validation rule 1–3). */
export class DuplicateDefinitionError extends DomainDefinitionError {
  constructor(kind: DefinitionKind, id: string) {
    super(`Duplicate ${kind} definition: ${id}`, 'CONFLICT', { kind, id });
  }
}

/**
 * A definition referenced a domain or capability that is not registered
 * (S24 validation rules 4–5).
 */
export class UnknownReferenceError extends DomainDefinitionError {
  constructor(
    kind: DefinitionKind,
    id: string,
    referencedKind: DefinitionKind,
    referencedId: string,
  ) {
    super(
      `Unknown ${referencedKind} referenced by ${kind} '${id}': ${referencedId}`,
      'VALIDATION_ERROR',
      { kind, id, referencedKind, referencedId },
    );
  }
}

/** A definition failed one or more deterministic validation rules. */
export class InvalidDefinitionError extends DomainDefinitionError {
  /** The field issues that failed. */
  readonly issues: readonly FieldIssue[];

  constructor(kind: DefinitionKind, id: string, issues: readonly FieldIssue[]) {
    super(`Invalid ${kind} definition '${id}'`, 'VALIDATION_ERROR', issues);
    this.issues = issues;
  }
}

/**
 * Normalizes an unknown thrown value onto the domain-definition error
 * vocabulary. Only {@link DomainDefinitionError} instances pass through
 * unchanged; anything else is wrapped as an internal error so the canonical
 * taxonomy is preserved at module boundaries.
 */
export function toDomainDefinitionError(error: unknown): DomainDefinitionError {
  if (error instanceof DomainDefinitionError) {
    return error;
  }
  if (error instanceof Error) {
    return new DomainDefinitionError(error.message, 'INTERNAL_ERROR', undefined, error);
  }
  return new DomainDefinitionError(String(error), 'INTERNAL_ERROR');
}
