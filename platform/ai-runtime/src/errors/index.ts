/**
 * @nexora/ai-runtime — runtime errors.
 *
 * The AI Runtime error hierarchy, extending the shared {@link NexoraError}
 * taxonomy (API_CONTRACTS.md §10). Runtime errors carry stable codes so the
 * application boundary can map them without inspecting messages. Errors from
 * the Agent SDK (`@nexora/agent-sdk/errors`) and shared modules are reused
 * directly where their semantics match; this module adds the runtime's own
 * stages (planning, execution, discovery, verification, providers,
 * conversation).
 */

import { NexoraError } from '@nexora/shared/errors';

/** Base class for every AI Runtime error. */
export class AiRuntimeError extends NexoraError {
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

/** Planning failed: no plan could be synthesized for the intent. */
export class PlanningError extends AiRuntimeError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'PLANNING_ERROR', details, cause);
  }
}

/** A plan step could not be executed. */
export class ExecutionError extends AiRuntimeError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'EXECUTION_ERROR', details, cause);
  }
}

/** Capability discovery failed or returned no usable results. */
export class DiscoveryError extends AiRuntimeError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'DISCOVERY_ERROR', details, cause);
  }
}

/** Verification could not be completed (not the same as a failed verification). */
export class VerificationError extends AiRuntimeError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'VERIFICATION_ERROR', details, cause);
  }
}

/** A model provider is missing, unconfigured, or failed. */
export class ProviderError extends AiRuntimeError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'PROVIDER_ERROR', details, cause);
  }
}

/** A conversation operation failed (session, history, summarization). */
export class ConversationError extends AiRuntimeError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'CONVERSATION_ERROR', details, cause);
  }
}

/** A capability could not be resolved to a skill/tool in the registry. */
export class CapabilityNotResolvedError extends AiRuntimeError {
  constructor(message: string, details?: unknown) {
    super(message, 'NOT_FOUND', details);
  }
}

/** The execution was blocked because required approval was not granted. */
export class ApprovalBlockedError extends AiRuntimeError {
  constructor(message: string, details?: unknown) {
    super(message, 'APPROVAL_REQUIRED', details);
  }
}
