/**
 * SDK error hierarchy tests.
 */

import { describe, expect, it } from 'vitest';
import { isNexoraError } from '@nexora/shared/errors';

import {
  AgentExecutionError,
  AgentInitializationError,
  AgentSdkError,
  ApprovalRequiredError,
  CapabilityNotFoundError,
  InvalidLifecycleTransitionError,
  PolicyViolationError,
  SkillNotFoundError,
  ToolNotFoundError,
} from '../src/errors/index.js';

describe('SDK errors', () => {
  it('derives all SDK errors from AgentSdkError and NexoraError', () => {
    const errors = [
      new AgentInitializationError('x'),
      new AgentExecutionError('x'),
      new CapabilityNotFoundError('x'),
      new SkillNotFoundError('x'),
      new ToolNotFoundError('x'),
      new PolicyViolationError('x'),
      new ApprovalRequiredError('x'),
      new InvalidLifecycleTransitionError('x'),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(AgentSdkError);
      expect(error).toBeInstanceOf(Error);
      expect(isNexoraError(error)).toBe(true);
    }
  });

  it('carries stable error codes', () => {
    expect(new AgentInitializationError('x').code).toBe('AGENT_INITIALIZATION_ERROR');
    expect(new AgentExecutionError('x').code).toBe('AGENT_EXECUTION_ERROR');
    expect(new CapabilityNotFoundError('x').code).toBe('NOT_FOUND');
    expect(new SkillNotFoundError('x').code).toBe('NOT_FOUND');
    expect(new ToolNotFoundError('x').code).toBe('NOT_FOUND');
    expect(new PolicyViolationError('x').code).toBe('POLICY_VIOLATION');
    expect(new ApprovalRequiredError('x').code).toBe('APPROVAL_REQUIRED');
    expect(new InvalidLifecycleTransitionError('x').code).toBe('INVALID_STATE');
  });

  it('preserves messages and details', () => {
    const error = new CapabilityNotFoundError('cap c1 missing', { capabilityId: 'c1' });
    expect(error.message).toBe('cap c1 missing');
    expect(error.details).toEqual({ capabilityId: 'c1' });
  });

  it('supports causes', () => {
    const cause = new Error('root');
    const error = new AgentExecutionError('failed', undefined, cause);
    expect(error.cause).toBe(cause);
  });
});
