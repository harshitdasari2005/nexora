import { describe, expect, it } from 'vitest';
import {
  FAILURE_CODES,
  classifyFailure,
  isRetryableClass,
  type FailureClass,
  type FailureCode,
  type RuntimeStage,
} from '../src/index.js';

type Row = [string, string | undefined, RuntimeStage, FailureCode, FailureClass];

const DELEGATION = [
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
];

const TABLE: Row[] = [
  ['POLICY_DENIED', 'crm.update', 'POLICY', 'POLICY_DENIED', 'DENIED'],
  ['POLICY_UNAVAILABLE', undefined, 'POLICY', 'POLICY_UNAVAILABLE', 'INFRASTRUCTURE'],
  [
    'POLICY_CHANGED_AFTER_APPROVAL',
    'crm.update',
    'APPROVAL',
    'POLICY_CHANGED_AFTER_APPROVAL',
    'APPROVAL',
  ],
  ['APPROVAL_ARGUMENTS_MISMATCH', 'crm.update', 'APPROVAL', 'APPROVAL_MISMATCH', 'APPROVAL'],
  ['APPROVAL_EXPIRED', 'crm.update', 'APPROVAL', 'APPROVAL_EXPIRED', 'APPROVAL'],
  ['APPROVAL_EXPIRED', undefined, 'APPROVAL', 'APPROVAL_EXPIRED', 'APPROVAL'],
  ['APPROVAL_NOT_BOUND', undefined, 'APPROVAL', 'APPROVAL_NOT_BOUND', 'APPROVAL'],
  ['APPROVAL_NOT_BOUND', 'crm.update', 'APPROVAL', 'APPROVAL_NOT_BOUND', 'APPROVAL'],
  ['FORBIDDEN', 'crm.update', 'AUTHORIZATION', 'RBAC_DENIED', 'DENIED'],
  ...DELEGATION.map((c): Row => [c, 'crm.update', 'AUTHORIZATION', 'AGENT_DENIED', 'DENIED']),
  ['RESERVED_ARGUMENT', 'crm.update', 'AUTHORIZATION', 'ARGUMENT_TRUST_VIOLATION', 'DENIED'],
  ['FORGED_AGENT_CONTEXT', 'crm.update', 'AUTHORIZATION', 'ARGUMENT_TRUST_VIOLATION', 'DENIED'],
  ['ARGUMENT_TOO_DEEP', 'crm.update', 'AUTHORIZATION', 'ARGUMENT_TRUST_VIOLATION', 'DENIED'],
  ['INVALID_ARGUMENTS', 'crm.update', 'EXECUTION', 'TOOL_ARGUMENT_INVALID', 'INPUT'],
  ['INVALID_INPUT', 'crm.update', 'EXECUTION', 'TOOL_ARGUMENT_INVALID', 'INPUT'],
  ['VALIDATION_ERROR', undefined, 'EXECUTION', 'TOOL_ARGUMENT_INVALID', 'INPUT'],
  ['UNVERIFIED', 'crm.update', 'VERIFICATION', 'VERIFICATION_FAILED', 'VERIFICATION'],
  ['MODEL_TIMEOUT', undefined, 'NARRATION', 'MODEL_TIMEOUT', 'TIMEOUT'],
  ['MODEL_ERROR', undefined, 'NARRATION', 'MODEL_ERROR', 'INFRASTRUCTURE'],
  ['TIMEOUT', 'crm.update', 'EXECUTION', 'TOOL_TIMEOUT', 'TIMEOUT'],
  ['TIMEOUT', undefined, 'EXECUTION', 'TOOL_TIMEOUT', 'TIMEOUT'],
  ['TIMEOUT', 'knowledge.search', 'RETRIEVAL', 'TOOL_TIMEOUT', 'TIMEOUT'],
  ['TIMEOUT', 'documents.search', 'RETRIEVAL', 'TOOL_TIMEOUT', 'TIMEOUT'],
  ['SOMETHING_ELSE', 'knowledge.search', 'RETRIEVAL', 'RETRIEVAL_FAILED', 'EXECUTION'],
  ['EXECUTION_ERROR', 'documents.search', 'RETRIEVAL', 'RETRIEVAL_FAILED', 'EXECUTION'],
  ['EXECUTION_ERROR', 'workflow.run', 'EXECUTION', 'WORKFLOW_FAILED', 'EXECUTION'],
  ['ANYTHING', 'workflow.start', 'EXECUTION', 'WORKFLOW_FAILED', 'EXECUTION'],
  ['PROVIDER_UNAVAILABLE', 'crm.update', 'EXECUTION', 'CONNECTOR_UNAVAILABLE', 'INFRASTRUCTURE'],
  ['CONNECTOR_UNAVAILABLE', 'crm.update', 'EXECUTION', 'CONNECTOR_UNAVAILABLE', 'INFRASTRUCTURE'],
  ['UNAVAILABLE', undefined, 'EXECUTION', 'CONNECTOR_UNAVAILABLE', 'INFRASTRUCTURE'],
  ['NOT_FOUND', 'crm.update', 'EXECUTION', 'REQUEST_INVALID', 'INPUT'],
  ['TOOL_NOT_FOUND', undefined, 'EXECUTION', 'REQUEST_INVALID', 'INPUT'],
  ['EXECUTION_ERROR', 'crm.update', 'EXECUTION', 'TOOL_EXECUTION_FAILED', 'EXECUTION'],
  ['EXECUTION_FAILED', undefined, 'EXECUTION', 'TOOL_EXECUTION_FAILED', 'EXECUTION'],
  ['WEIRD_CODE', 'crm.update', 'EXECUTION', 'TOOL_EXECUTION_FAILED', 'EXECUTION'],
  ['WEIRD_CODE', undefined, 'EXECUTION', 'INTERNAL_ERROR', 'INTERNAL'],
];

describe('classifyFailure', () => {
  it.each(TABLE)('%s (tool=%s) -> %s / %s / %s', (code, toolId, stage, taxonomy, klass) => {
    const result = classifyFailure({ code, ...(toolId === undefined ? {} : { toolId }) });
    expect(result.stage).toBe(stage);
    expect(result.code).toBe(taxonomy);
    expect(result.class).toBe(klass);
    expect(result.sourceCode).toBe(code);
  });

  it('carries toolId and invocationId only when provided', () => {
    const bare = classifyFailure({ code: 'FORBIDDEN' });
    expect('toolId' in bare).toBe(false);
    expect('invocationId' in bare).toBe(false);
    const full = classifyFailure({ code: 'FORBIDDEN', toolId: 't.x', invocationId: 'inv_1' });
    expect(full.toolId).toBe('t.x');
    expect(full.invocationId).toBe('inv_1');
  });

  it('reaches every producer-backed taxonomy code', () => {
    const reached = new Set(TABLE.map(([, , , taxonomy]) => taxonomy));
    // Every code in the taxonomy has a real producer (no reserved/unused codes).
    for (const code of FAILURE_CODES as readonly FailureCode[]) {
      expect(reached.has(code), code).toBe(true);
    }
  });

  it('INTERNAL_ERROR/INTERNAL only when there is no tool id', () => {
    for (const [code, toolId] of TABLE) {
      const r = classifyFailure({ code, ...(toolId === undefined ? {} : { toolId }) });
      if (r.class === 'INTERNAL') expect(toolId).toBeUndefined();
    }
    expect(classifyFailure({ code: 'WEIRD', toolId: 'x.y' }).class).not.toBe('INTERNAL');
  });

  it('never reports DENIED for infrastructure, timeout or tool codes', () => {
    const nonDenied = [
      'POLICY_UNAVAILABLE',
      'MODEL_ERROR',
      'MODEL_TIMEOUT',
      'TIMEOUT',
      'PROVIDER_UNAVAILABLE',
      'CONNECTOR_UNAVAILABLE',
      'UNAVAILABLE',
      'EXECUTION_ERROR',
      'EXECUTION_FAILED',
      'NOT_FOUND',
      'UNVERIFIED',
      'INVALID_ARGUMENTS',
    ];
    for (const code of nonDenied) {
      for (const toolId of [undefined, 'crm.update', 'knowledge.search', 'workflow.run']) {
        const r = classifyFailure({ code, ...(toolId === undefined ? {} : { toolId }) });
        expect(r.class, `${code}/${toolId}`).not.toBe('DENIED');
      }
    }
  });
});

describe('isRetryableClass', () => {
  it('retries only infrastructure and timeouts', () => {
    const all: FailureClass[] = [
      'DENIED',
      'APPROVAL',
      'INPUT',
      'EXECUTION',
      'VERIFICATION',
      'INFRASTRUCTURE',
      'TIMEOUT',
      'INTERNAL',
    ];
    expect(all.filter(isRetryableClass)).toEqual(['INFRASTRUCTURE', 'TIMEOUT']);
  });
});
