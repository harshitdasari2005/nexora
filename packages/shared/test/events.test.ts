/**
 * Unit tests for the event envelope factory (`src/events`).
 */

import { describe, expect, it } from 'vitest';

import { createEventEnvelope } from '../src/events/index.js';

const base = {
  type: 'employee.created',
  version: 1,
  tenantId: 'tenant_1',
  correlationId: 'corr_1',
  actor: { kind: 'user' as const, id: 'user_1' },
  payload: { employeeId: 'emp_1' },
};

describe('createEventEnvelope', () => {
  it('fills id, occurredAt, and version when not provided', () => {
    const envelope = createEventEnvelope(base);

    expect(envelope.id.startsWith('evt_')).toBe(true);
    expect(envelope.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(envelope.version).toBe(1);
  });

  it('preserves caller-provided id and occurredAt', () => {
    const envelope = createEventEnvelope({
      ...base,
      id: 'evt_custom',
      occurredAt: '2026-08-08T00:00:00.000Z',
    });

    expect(envelope.id).toBe('evt_custom');
    expect(envelope.occurredAt).toBe('2026-08-08T00:00:00.000Z');
  });

  it('defaults metadata to platform/normal/at_least_once', () => {
    const envelope = createEventEnvelope(base);

    expect(envelope.metadata).toEqual({
      version: 1,
      category: 'platform',
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    });
  });

  it('honors caller-provided metadata', () => {
    const envelope = createEventEnvelope({
      ...base,
      metadata: {
        version: 1,
        category: 'hr',
        priority: 'high',
        deliverySemantics: 'exactly_once',
      },
    });

    expect(envelope.metadata).toEqual({
      version: 1,
      category: 'hr',
      priority: 'high',
      deliverySemantics: 'exactly_once',
    });
  });
});
