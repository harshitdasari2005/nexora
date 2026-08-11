/**
 * @nexora/ai-runtime — error hierarchy tests.
 */

import { describe, expect, it } from 'vitest';
import { isNexoraError } from '@nexora/shared/errors';

import {
  AiRuntimeError,
  ApprovalBlockedError,
  CapabilityNotResolvedError,
  ConversationError,
  DiscoveryError,
  ExecutionError,
  PlanningError,
  ProviderError,
  VerificationError,
} from '../src/errors/index.js';

describe('AiRuntimeError hierarchy', () => {
  it('extends the shared NexoraError hierarchy', () => {
    const error = new PlanningError('nope');
    expect(error).toBeInstanceOf(AiRuntimeError);
    expect(isNexoraError(error)).toBe(true);
  });

  it('carries stable error codes', () => {
    expect(new PlanningError('x').code).toBe('PLANNING_ERROR');
    expect(new ExecutionError('x').code).toBe('EXECUTION_ERROR');
    expect(new DiscoveryError('x').code).toBe('DISCOVERY_ERROR');
    expect(new VerificationError('x').code).toBe('VERIFICATION_ERROR');
    expect(new ProviderError('x').code).toBe('PROVIDER_ERROR');
    expect(new ConversationError('x').code).toBe('CONVERSATION_ERROR');
  });

  it('maps not-found and approval codes to the API taxonomy', () => {
    expect(new CapabilityNotResolvedError('x').code).toBe('NOT_FOUND');
    expect(new ApprovalBlockedError('x').code).toBe('APPROVAL_REQUIRED');
  });

  it('preserves details and cause', () => {
    const cause = new Error('root');
    const error = new ExecutionError('failed', { toolId: 't1' }, cause);
    expect(error.details).toEqual({ toolId: 't1' });
    expect(error.cause).toBe(cause);
  });

  it('sets the error name to the concrete class', () => {
    expect(new ProviderError('x').name).toBe('ProviderError');
    expect(new DiscoveryError('x').name).toBe('DiscoveryError');
  });
});
