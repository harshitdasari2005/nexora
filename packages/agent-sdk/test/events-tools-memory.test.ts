/**
 * Event bus, tool execution, and memory provider tests.
 */

import { describe, expect, it } from 'vitest';

import { AgentEventBus } from '../src/events/index.js';
import { FakeMemoryProvider, MockTool, testManifest } from '../src/testing/index.js';
import type { MemoryItem } from '../src/memory/index.js';

describe('AgentEventBus', () => {
  it('publishes to subscribers', () => {
    const bus = new AgentEventBus();
    const received: string[] = [];
    bus.subscribe((event) => received.push(event.type));
    bus.publish({ type: 'agent.registered', agentId: 'agt_1', version: '1.0.0', occurredAt: 't' });
    expect(received).toEqual(['agent.registered']);
  });

  it('keeps history of published events', () => {
    const bus = new AgentEventBus();
    bus.publish({ type: 'agent.ready', agentId: 'agt_1', occurredAt: 't' });
    expect(bus.history()).toHaveLength(1);
    expect(bus.history()[0]?.type).toBe('agent.ready');
  });

  it('unsubscribes listeners', () => {
    const bus = new AgentEventBus();
    let count = 0;
    const unsubscribe = bus.subscribe(() => {
      count += 1;
    });
    unsubscribe();
    bus.publish({ type: 'agent.ready', agentId: 'agt_1', occurredAt: 't' });
    expect(count).toBe(0);
  });

  it('tracks subscriber presence', () => {
    const bus = new AgentEventBus();
    expect(bus.hasSubscribers).toBe(false);
    bus.subscribe(() => {});
    expect(bus.hasSubscribers).toBe(true);
  });

  it('accepts every event variant', () => {
    const bus = new AgentEventBus();
    bus.publish({ type: 'agent.registered', agentId: 'agt_1', version: '1.0.0', occurredAt: 't' });
    bus.publish({ type: 'agent.ready', agentId: 'agt_1', occurredAt: 't' });
    bus.publish({
      type: 'execution.started',
      agentId: 'agt_1',
      executionId: 'e1',
      occurredAt: 't',
    });
    bus.publish({
      type: 'execution.completed',
      agentId: 'agt_1',
      executionId: 'e1',
      occurredAt: 't',
      finishedAt: 't',
    });
    bus.publish({
      type: 'execution.failed',
      agentId: 'agt_1',
      executionId: 'e1',
      code: 'X',
      message: 'x',
      occurredAt: 't',
    });
    bus.publish({
      type: 'health.changed',
      agentId: 'agt_1',
      previous: 'healthy',
      current: 'degraded',
      occurredAt: 't',
    });
    bus.publish({
      type: 'capability.added',
      agentId: 'agt_1',
      capabilityId: 'c1',
      occurredAt: 't',
    });
    bus.publish({
      type: 'capability.removed',
      agentId: 'agt_1',
      capabilityId: 'c1',
      occurredAt: 't',
    });
    expect(bus.history()).toHaveLength(8);
  });
});

describe('MockTool', () => {
  const manifest = {
    id: 'tool_1',
    name: 'Tool 1',
    description: 'd',
    sideEffectClass: 'read_only' as const,
    idempotent: true,
    timeoutMs: 1000,
    inputSchema: {},
  };

  it('echoes input on success', async () => {
    const tool = new MockTool(manifest);
    const result = await tool.execute(
      { a: 1 },
      { userId: 'usr_1', tenantId: 't1', executionId: 'e1' },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ echoed: { a: 1 } });
    expect(tool.invocations).toBe(1);
  });

  it('uses the custom handler when provided', async () => {
    const tool = new MockTool(manifest, () => ({
      ok: false as const,
      error: 'nope',
      completedAt: 't',
    }));
    const result = await tool.execute({}, { userId: 'usr_1', tenantId: 't1', executionId: 'e1' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('nope');
  });

  it('counts invocations across calls', async () => {
    const tool = new MockTool(manifest);
    await tool.execute({}, { userId: 'usr_1', tenantId: 't1', executionId: 'e1' });
    await tool.execute({}, { userId: 'usr_1', tenantId: 't1', executionId: 'e1' });
    expect(tool.invocations).toBe(2);
  });
});

describe('FakeMemoryProvider', () => {
  it('stores and retrieves items', async () => {
    const provider = new FakeMemoryProvider();
    const item: MemoryItem = { id: 'm1', content: 'hello', createdAt: 't' };
    await provider.store(item);
    const result = await provider.retrieve();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.content).toBe('hello');
  });

  it('captures snapshots of stored items', async () => {
    const provider = new FakeMemoryProvider();
    await provider.store({ id: 'm1', content: 'a', createdAt: 't' });
    const snapshot = await provider.snapshot();
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.agentId).toBe('agt_test');
  });

  it('returns empty results before any store', async () => {
    const provider = new FakeMemoryProvider();
    const result = await provider.retrieve();
    expect(result.items).toHaveLength(0);
  });
});

describe('testManifest', () => {
  it('builds a valid default manifest', () => {
    const manifest = testManifest();
    expect(manifest.identity.id).toBe('agt_test');
    expect(manifest.version).toBe('1.0.0');
  });

  it('applies overrides', () => {
    const manifest = testManifest({ version: '2.0.0' });
    expect(manifest.version).toBe('2.0.0');
    expect(manifest.identity.id).toBe('agt_test');
  });
});
