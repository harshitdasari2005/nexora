/**
 * @nexora/module-command-center — command center errors.
 *
 * The command-center error vocabulary (S24 Phase 2; API_CONTRACTS.md §10
 * taxonomy). Every error extends the shared {@link NexoraError} hierarchy so
 * codes stay canonical and cross-boundary error handling works unchanged
 * (ENGINEERING_PLAYBOOK.md §4.2). These errors are raised at REGISTRATION
 * time — command-center configuration is validated when definitions are
 * registered, never discovered mid-request.
 */

import { NexoraError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';

/** The kind of definition an error refers to. */
export type CommandCenterDefinitionKind = 'command-center' | 'widget' | 'action';

/**
 * Base class for every command-center error. All concrete errors extend this
 * so callers can catch the whole family with one `instanceof` check.
 */
export class CommandCenterError extends NexoraError {
  constructor(
    message: string,
    code: ErrorCode = 'VALIDATION_ERROR',
    details?: unknown,
    cause?: unknown,
  ) {
    super(message, code, details, cause);
  }
}

/** A command-center definition id was registered more than once. */
export class DuplicateCommandCenterError extends CommandCenterError {
  constructor(id: string) {
    super(`Duplicate command-center definition: ${id}`, 'CONFLICT', { id });
  }
}

/**
 * A command center referenced a domain or role that is not registered in
 * the Phase 1 catalog (or a role that does not belong to the given domain).
 */
export class UnknownRoleReferenceError extends CommandCenterError {
  constructor(commandCenterId: string, domainId: string, roleId: string) {
    super(
      `Command center '${commandCenterId}' references role '${roleId}' of domain '${domainId}', which is not registered`,
      'VALIDATION_ERROR',
      { commandCenterId, domainId, roleId },
    );
  }
}

/** A command-center definition failed one or more deterministic validation rules. */
export class InvalidCommandCenterError extends CommandCenterError {
  /** The field issues that failed. */
  readonly issues: readonly FieldIssue[];

  constructor(id: string, issues: readonly FieldIssue[]) {
    super(`Invalid command-center definition '${id}'`, 'VALIDATION_ERROR', issues);
    this.issues = issues;
  }
}

/**
 * Normalizes an unknown thrown value onto the command-center error
 * vocabulary. Only {@link CommandCenterError} instances pass through
 * unchanged; anything else is wrapped as an internal error so the canonical
 * taxonomy is preserved at module boundaries.
 */
export function toCommandCenterError(error: unknown): CommandCenterError {
  if (error instanceof CommandCenterError) {
    return error;
  }
  if (error instanceof Error) {
    return new CommandCenterError(error.message, 'INTERNAL_ERROR', undefined, error);
  }
  return new CommandCenterError(String(error), 'INTERNAL_ERROR');
}
