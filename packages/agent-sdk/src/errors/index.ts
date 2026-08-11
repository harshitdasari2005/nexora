/**
 * @nexora/agent-sdk — SDK errors.
 *
 * SDK-specific errors extending the shared `NexoraError` hierarchy
 * (`@nexora/shared/errors`). Codes follow the API error taxonomy
 * (API_CONTRACTS.md §10); agents extend this hierarchy further with their
 * own codes rather than throwing raw errors across boundaries
 * (ENGINEERING_PLAYBOOK.md §4.2).
 */

import { NexoraError, TimeoutError } from '@nexora/shared/errors';

/** Base class for all Agent SDK errors. */
export class AgentSdkError extends NexoraError {
  /**
   * @param message - human-readable message.
   * @param code    - stable error code (API_CONTRACTS.md §10 taxonomy).
   * @param details - optional structured details.
   * @param cause   - optional originating error.
   */
  constructor(message: string, code: string, details?: unknown, cause?: unknown) {
    super(message, code as never, details, cause);
  }
}

/** The agent could not be initialized (bad manifest, missing configuration). */
export class AgentInitializationError extends AgentSdkError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'AGENT_INITIALIZATION_ERROR', details, cause);
  }
}

/** The agent failed during execution. */
export class AgentExecutionError extends AgentSdkError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'AGENT_EXECUTION_ERROR', details, cause);
  }
}

/**
 * The execution exceeded its configured time budget (AIR.md §10.5 timeout).
 * Thrown internally by `BaseAgent`; surfaced as a `TIMEOUT` failure.
 * Extends the shared `TimeoutError` so the instance itself carries the
 * canonical `TIMEOUT` code.
 */
export class AgentExecutionTimeoutError extends TimeoutError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, details, cause);
  }
}

/** A requested capability does not exist on the agent. */
export class CapabilityNotFoundError extends AgentSdkError {
  constructor(message: string, details?: unknown) {
    super(message, 'NOT_FOUND', details);
  }
}

/** A requested skill does not exist on the agent. */
export class SkillNotFoundError extends AgentSdkError {
  constructor(message: string, details?: unknown) {
    super(message, 'NOT_FOUND', details);
  }
}

/** A requested tool does not exist on the agent. */
export class ToolNotFoundError extends AgentSdkError {
  constructor(message: string, details?: unknown) {
    super(message, 'NOT_FOUND', details);
  }
}

/**
 * A policy evaluation denied the execution (deny-wins, AIR.md §13). Distinct
 * from the shared `PolicyViolationError` only in identity; reuse the shared
 * class when the denial originates from a shared policy.
 */
export class PolicyViolationError extends AgentSdkError {
  constructor(message: string, details?: unknown) {
    super(message, 'POLICY_VIOLATION', details);
  }
}

/** The execution requires human approval that has not been granted (AIR.md §12). */
export class ApprovalRequiredError extends AgentSdkError {
  constructor(message: string, details?: unknown) {
    super(message, 'APPROVAL_REQUIRED', details);
  }
}

/** The lifecycle operation is invalid in the current state. */
export class InvalidLifecycleTransitionError extends AgentSdkError {
  constructor(message: string, details?: unknown) {
    super(message, 'INVALID_STATE', details);
  }
}
