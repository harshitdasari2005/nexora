import type { FailureClass, FailureCode, RunFailure, RuntimeStage } from './contracts.js';

/** What the classifier needs to know about a failed step. */
export interface FailureInput {
  /** The executor / orchestrator / adapter code (`POLICY_DENIED`, `FORBIDDEN`, `TIMEOUT`, …). */
  code: string;
  toolId?: string;
  invocationId?: string;
}

const DELEGATION_CODES = new Set([
  'AGENT_NOT_AUTHORIZED',
  'AGENT_AUTHORITY_UNAVAILABLE',
  'AGENT_NOT_FOUND',
  'AGENT_SUSPENDED',
  'AGENT_REVOKED',
  'AGENT_OUT_OF_SCOPE',
  'CAPABILITY_NOT_DELEGABLE',
  'CAPABILITY_OUTSIDE_AGENT_DEFINITION',
  'CAPABILITY_OUTSIDE_DELEGATION',
  'INITIATOR_LACKS_CAPABILITY',
  'DELEGATION_MISSING',
  'DELEGATION_REVOKED',
  'DELEGATION_EXPIRED',
  'DELEGATION_GRANTOR_LACKS_CAPABILITY',
  'DELEGATION_RESOURCE_OUT_OF_SCOPE',
  'DELEGATION_EXCEEDS_USER_AUTHORITY',
]);

const RETRIEVAL_TOOLS = new Set(['knowledge.search', 'documents.search']);

function failure(
  stage: RuntimeStage,
  code: FailureCode,
  failureClass: FailureClass,
  input: FailureInput,
): RunFailure {
  return {
    stage,
    code,
    class: failureClass,
    sourceCode: input.code,
    ...(input.toolId === undefined ? {} : { toolId: input.toolId }),
    ...(input.invocationId === undefined ? {} : { invocationId: input.invocationId }),
  };
}

/**
 * Maps a real failure code to WHERE (stage) and WHY (taxonomy code + class).
 * Deterministic and total: every code maps somewhere, unknown codes to
 * `INTERNAL_ERROR` — but a code the system KNOWS is a timeout, a security
 * refusal or a policy denial is never reported as generic.
 */
export function classifyFailure(input: FailureInput): RunFailure {
  const { code, toolId } = input;
  if (code === 'POLICY_DENIED') return failure('POLICY', 'POLICY_DENIED', 'DENIED', input);
  if (code === 'POLICY_UNAVAILABLE')
    return failure('POLICY', 'POLICY_UNAVAILABLE', 'INFRASTRUCTURE', input);
  if (code === 'POLICY_CHANGED_AFTER_APPROVAL') {
    return failure('APPROVAL', 'POLICY_CHANGED_AFTER_APPROVAL', 'APPROVAL', input);
  }
  if (code === 'APPROVAL_EXPIRED') {
    return failure('APPROVAL', 'APPROVAL_EXPIRED', 'APPROVAL', input);
  }
  if (code === 'APPROVAL_NOT_BOUND') {
    return failure('APPROVAL', 'APPROVAL_NOT_BOUND', 'APPROVAL', input);
  }
  if (code === 'APPROVAL_ARGUMENTS_MISMATCH')
    return failure('APPROVAL', 'APPROVAL_MISMATCH', 'APPROVAL', input);
  if (code === 'FORBIDDEN') return failure('AUTHORIZATION', 'RBAC_DENIED', 'DENIED', input);
  if (DELEGATION_CODES.has(code)) return failure('AUTHORIZATION', 'AGENT_DENIED', 'DENIED', input);
  if (
    code === 'RESERVED_ARGUMENT' ||
    code === 'FORGED_AGENT_CONTEXT' ||
    code === 'ARGUMENT_TOO_DEEP'
  ) {
    return failure('AUTHORIZATION', 'ARGUMENT_TRUST_VIOLATION', 'DENIED', input);
  }
  if (code === 'INVALID_ARGUMENTS' || code === 'INVALID_INPUT' || code === 'VALIDATION_ERROR') {
    return failure('EXECUTION', 'TOOL_ARGUMENT_INVALID', 'INPUT', input);
  }
  if (code === 'UNVERIFIED')
    return failure('VERIFICATION', 'VERIFICATION_FAILED', 'VERIFICATION', input);
  if (code === 'MODEL_TIMEOUT') return failure('NARRATION', 'MODEL_TIMEOUT', 'TIMEOUT', input);
  if (code === 'MODEL_ERROR') return failure('NARRATION', 'MODEL_ERROR', 'INFRASTRUCTURE', input);
  if (code === 'TIMEOUT') {
    const stage: RuntimeStage =
      toolId !== undefined && RETRIEVAL_TOOLS.has(toolId) ? 'RETRIEVAL' : 'EXECUTION';
    return failure(stage, 'TOOL_TIMEOUT', 'TIMEOUT', input);
  }
  if (toolId !== undefined && RETRIEVAL_TOOLS.has(toolId)) {
    return failure('RETRIEVAL', 'RETRIEVAL_FAILED', 'EXECUTION', input);
  }
  if (toolId !== undefined && toolId.startsWith('workflow.')) {
    return failure('EXECUTION', 'WORKFLOW_FAILED', 'EXECUTION', input);
  }
  if (
    code === 'PROVIDER_UNAVAILABLE' ||
    code === 'CONNECTOR_UNAVAILABLE' ||
    code === 'UNAVAILABLE'
  ) {
    return failure('EXECUTION', 'CONNECTOR_UNAVAILABLE', 'INFRASTRUCTURE', input);
  }
  if (code === 'NOT_FOUND' || code === 'TOOL_NOT_FOUND') {
    return failure('EXECUTION', 'REQUEST_INVALID', 'INPUT', input);
  }
  if (code === 'EXECUTION_ERROR' || code === 'EXECUTION_FAILED') {
    return failure('EXECUTION', 'TOOL_EXECUTION_FAILED', 'EXECUTION', input);
  }
  // A failed tool with an unrecognised code is still a tool failure; a failure
  // with no tool at all is an unclassified internal error.
  return toolId === undefined
    ? failure('EXECUTION', 'INTERNAL_ERROR', 'INTERNAL', input)
    : failure('EXECUTION', 'TOOL_EXECUTION_FAILED', 'EXECUTION', input);
}

/**
 * Whether a failure class is transient infrastructure — the ONLY class a
 * retry may ever be attempted for. Security denials, policy denials and
 * approval refusals are deliberate outcomes, never retried.
 */
export function isRetryableClass(failureClass: FailureClass): boolean {
  return failureClass === 'INFRASTRUCTURE' || failureClass === 'TIMEOUT';
}
