/**
 * @nexora/ai-runtime — events tests.
 */

import { describe, expect, it } from 'vitest';

import { RuntimeEventBus } from '../src/events/runtime-events.js';
import { toEventEnvelope } from '../src/events/event-envelope.js';

describe('RuntimeEventBus', () => {
  it('publishes to subscribers', () => {
    const bus = new RuntimeEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => seen.push(event.type));
    bus.publish({
      type: 'plan.created',
      runId: 'r',
      planId: 'p',
      intent: 'i',
      stepCount: 1,
      gateCount: 0,
      occurredAt: 'x',
    });
    expect(seen).toEqual(['plan.created']);
  });

  it('unsubscribes', () => {
    const bus = new RuntimeEventBus();
    let count = 0;
    const unsubscribe = bus.subscribe(() => {
      count += 1;
    });
    unsubscribe();
    bus.publish({
      type: 'plan.created',
      runId: 'r',
      planId: 'p',
      intent: 'i',
      stepCount: 1,
      gateCount: 0,
      occurredAt: 'x',
    });
    expect(count).toBe(0);
  });

  it('records bounded history', () => {
    const bus = new RuntimeEventBus(2);
    bus.publish({
      type: 'plan.created',
      runId: 'r1',
      planId: 'p',
      intent: 'i',
      stepCount: 1,
      gateCount: 0,
      occurredAt: 'x',
    });
    bus.publish({ type: 'tool.invoked', runId: 'r2', toolId: 't', stepId: 's', occurredAt: 'x' });
    bus.publish({
      type: 'tool.succeeded',
      runId: 'r3',
      toolId: 't',
      stepId: 's',
      verified: true,
      occurredAt: 'x',
    });
    expect(bus.history()).toHaveLength(2);
    expect(bus.history()[0]?.type).toBe('tool.invoked');
  });

  it('tracks subscriber presence', () => {
    const bus = new RuntimeEventBus();
    expect(bus.hasSubscribers).toBe(false);
    const unsubscribe = bus.subscribe(() => {});
    expect(bus.hasSubscribers).toBe(true);
    unsubscribe();
    expect(bus.hasSubscribers).toBe(false);
  });
});

describe('toEventEnvelope', () => {
  it('maps a runtime event to a canonical envelope', () => {
    const event = {
      type: 'plan.created' as const,
      runId: 'run_1',
      planId: 'plan_1',
      intent: 'hire',
      stepCount: 2,
      gateCount: 1,
      occurredAt: '2026-08-08T00:00:00.000Z',
    };
    const envelope = toEventEnvelope(event, {
      tenantId: 'tenant_1',
      workspaceId: 'ws_1',
      actor: { kind: 'user', id: 'user_1' },
    });
    expect(envelope.type).toBe('plan.created');
    expect(envelope.tenantId).toBe('tenant_1');
    expect(envelope.workspaceId).toBe('ws_1');
    expect(envelope.actor.kind).toBe('user');
    expect(envelope.metadata?.category).toBe('ai');
    expect(envelope.payload).toMatchObject({ runId: 'run_1', planId: 'plan_1' });
  });

  it('maps failure events to high priority', () => {
    const envelope = toEventEnvelope(
      {
        type: 'tool.failed',
        runId: 'r',
        toolId: 't',
        stepId: 's',
        code: 'X',
        message: 'x',
        occurredAt: 'x',
      },
      { tenantId: 't', actor: { kind: 'agent', id: 'a' } },
    );
    expect(envelope.metadata?.priority).toBe('high');
  });

  it('uses the run id as the correlation id', () => {
    const envelope = toEventEnvelope(
      {
        type: 'response.generated',
        runId: 'run_9',
        conversationId: 'c',
        status: 'completed',
        occurredAt: 'x',
      },
      { tenantId: 't', actor: { kind: 'system', id: 's' } },
    );
    expect(envelope.correlationId).toBe('run_9');
  });

  it('strips envelope metadata keys from the payload', () => {
    const envelope = toEventEnvelope(
      {
        type: 'tool.failed',
        runId: 'run_1',
        toolId: 't',
        stepId: 's',
        code: 'X',
        message: 'boom',
        occurredAt: '2026-08-08T00:00:00.000Z',
      },
      { tenantId: 't', actor: { kind: 'agent', id: 'a' } },
    );
    expect(envelope.payload).not.toHaveProperty('type');
    expect(envelope.payload).not.toHaveProperty('occurredAt');
    expect(envelope.payload).toMatchObject({ runId: 'run_1', code: 'X', message: 'boom' });
  });
});
