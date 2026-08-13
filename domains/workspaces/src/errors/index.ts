/**
 * @nexora/domain-workspaces — domain errors.
 *
 * The Workspaces bounded context error vocabulary (DOMAIN_MODEL.md §1
 * Tenancy; PSD.md §4 WS-*). Every error extends the shared `NexoraError`
 * hierarchy so codes stay canonical (API_CONTRACTS.md §10 taxonomy) and
 * cross-boundary error handling works unchanged
 * (ENGINEERING_PLAYBOOK.md §4.2).
 */

import { NexoraError, ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';

/**
 * Base class for every Workspaces domain error. All concrete errors extend
 * this so services can catch the whole bounded-context family with one
 * `instanceof` check.
 */
export class WorkspaceDomainError extends NexoraError {
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
 * slug, invalid color, ...). Carries field issues and the canonical
 * `VALIDATION_ERROR` code. `toWorkspaceError` maps shared
 * {@link ValidationError}s onto this type so callers see one validation error
 * family.
 */
export class InvalidWorkspaceValueError extends WorkspaceDomainError {
  /** The field issues that failed. */
  readonly issues: readonly FieldIssue[];

  constructor(message: string, issues: readonly FieldIssue[], details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.issues = issues;
  }
}

/** The workspace does not exist (or is not visible to the caller). */
export class WorkspaceNotFoundError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Workspace not found', 'NOT_FOUND', details);
  }
}

/** A workspace with the same slug already exists in the organization. */
export class SlugAlreadyExistsError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Workspace slug already exists', 'CONFLICT', details);
  }
}

/** A workspace lifecycle transition was attempted that the policy forbids. */
export class WorkspaceStateTransitionError extends WorkspaceDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The workspace is not in an active state and cannot perform the action. */
export class WorkspaceNotActiveError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Workspace is not active', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The workspace is archived and rejects every mutation (immutable). */
export class WorkspaceArchivedError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Workspace is archived', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The membership does not exist in the workspace. */
export class MemberNotFoundError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Membership not found', 'NOT_FOUND', details);
  }
}

/** The user is already a member of the workspace. */
export class MemberAlreadyExistsError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('User is already a member', 'CONFLICT', details);
  }
}

/** The last owner of a workspace cannot be removed or demoted. */
export class LastOwnerRemovalError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('A workspace must retain at least one owner', 'BUSINESS_RULE_VIOLATION', details);
  }
}

/** The plugin is not installed in the workspace. */
export class PluginNotFoundError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Plugin not installed', 'NOT_FOUND', details);
  }
}

/** The plugin is already installed in the workspace. */
export class PluginAlreadyInstalledError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Plugin already installed', 'CONFLICT', details);
  }
}

/** The plugin is already at the requested version (update is a no-op). */
export class PluginVersionUnchangedError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Plugin is already at this version', 'CONFLICT', details);
  }
}

/** The app is not listed in the marketplace catalog. */
export class MarketplaceAppNotFoundError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('App not found in the marketplace', 'NOT_FOUND', details);
  }
}

/** The install-time permission review was not confirmed. */
export class PermissionReviewRequiredError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super(
      'Permission review must be confirmed before installing this app',
      'PERMISSION_REVIEW_REQUIRED',
      details,
    );
  }
}

/** The agent is already bound to the workspace. */
export class AgentAlreadyBoundError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Agent already bound', 'CONFLICT', details);
  }
}

/** The agent is not bound to the workspace. */
export class AgentNotBoundError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Agent not bound', 'NOT_FOUND', details);
  }
}

/** The knowledge source is already attached to the workspace. */
export class KnowledgeAlreadyAttachedError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Knowledge source already attached', 'CONFLICT', details);
  }
}

/** The knowledge source is not attached to the workspace. */
export class KnowledgeNotAttachedError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Knowledge source not attached', 'NOT_FOUND', details);
  }
}

/** The workflow is already attached to the workspace. */
export class WorkflowAlreadyAttachedError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Workflow already attached', 'CONFLICT', details);
  }
}

/** The workflow is not attached to the workspace. */
export class WorkflowNotAttachedError extends WorkspaceDomainError {
  constructor(details?: unknown) {
    super('Workflow not attached', 'NOT_FOUND', details);
  }
}

/** Type guard: true when the value is any Workspaces domain error. */
export function isWorkspaceDomainError(value: unknown): value is WorkspaceDomainError {
  return value instanceof WorkspaceDomainError;
}

/**
 * Maps an unknown thrown value to a {@link WorkspaceDomainError}. Workspace
 * errors and shared {@link ValidationError}s pass through unchanged; anything
 * else is wrapped so services can consistently return
 * `Result<T, WorkspaceDomainError>`.
 */
export function toWorkspaceError(error: unknown): WorkspaceDomainError {
  if (error instanceof WorkspaceDomainError) {
    return error;
  }
  if (error instanceof ValidationError) {
    return new InvalidWorkspaceValueError(error.message, error.issues, error.details);
  }
  if (error instanceof Error) {
    return new WorkspaceDomainError(error.message, 'INTERNAL_ERROR', undefined, error);
  }
  return new WorkspaceDomainError(String(error), 'INTERNAL_ERROR');
}
