/**
 * @nexora/mcp — error model.
 *
 * MCP errors map cleanly to Nexora concepts (S24 Phase 5): protocol-level
 * errors (unknown tool, invalid input) surface as MCP JSON-RPC errors with
 * stable codes; tool-level failures surface as structured tool results with
 * `isError` (so a client can read and self-correct). Internal stack traces
 * and database errors are never leaked.
 */

/**
 * The stable Nexora error vocabulary for MCP tool results. Mirrors the
 * runtime's error codes so clients can branch deterministically.
 */
export const MCP_RESULT_CODES = {
  /** The tool does not exist or is not available to the caller. */
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  /** The caller lacks the capability affinity for the tool. */
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  /** The tool arguments failed strict schema validation. */
  INVALID_INPUT: 'INVALID_INPUT',
  /** The caller is not authenticated for this scope. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** The caller is not authorized for the requested operation. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Execution is gated pending human approval. */
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  /** A previously pending approval was rejected. */
  APPROVAL_DENIED: 'APPROVAL_DENIED',
  /** The execution failed. */
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  /** The execution succeeded but verification against persisted state failed. */
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  /** The target was not found in the caller's scope. */
  NOT_FOUND: 'NOT_FOUND',
} as const;

/** A structured Nexora error carried in an MCP tool result. */
export interface StructuredToolError {
  /** The stable error code (see {@link MCP_RESULT_CODES}). */
  code: string;
  /** A safe human-readable message. */
  message: string;
  /** Optional structured detail (e.g. `approvalId`). */
  details?: Record<string, unknown>;
}

/** Builds a {@link StructuredToolError} with a code + message. */
export function toolError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): {
  ok: false;
  error: StructuredToolError;
} {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } };
}
