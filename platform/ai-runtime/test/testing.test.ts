/**
 * @nexora/ai-runtime — testing helpers tests.
 */

import { describe, expect, it } from 'vitest';

import { MockModelProvider, MockChatProvider } from '../src/testing/mock-provider.js';
import { MockTool, MockToolExecutor, mockToolManifest } from '../src/testing/mock-tools.js';
import { FakeConversationStore } from '../src/testing/fakes.js';
import { nowIso } from '@nexora/shared/time';

describe('MockChatProvider', () => {
  it('returns the scripted response and records requests', async () => {
    const provider = new MockChatProvider();
    provider.response = { content: 'hello', finishReason: 'stop', model: 'mock' };
    const response = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.content).toBe('hello');
    expect(provider.completions).toHaveLength(1);
  });
});

describe('MockModelProvider', () => {
  it('implements the ModelProvider contract', () => {
    const provider = new MockModelProvider();
    expect(provider.chat).toBeInstanceOf(MockChatProvider);
    expect(provider.models).toContain('mock-model');
    expect(provider.capabilities).toContain('chat');
  });

  it('honors a custom response', async () => {
    const provider = new MockModelProvider({
      response: { content: 'custom', finishReason: 'stop', model: 'mock' },
    });
    const response = await provider.chat.complete({ messages: [] });
    expect(response.content).toBe('custom');
  });
});

describe('MockTool', () => {
  it('records invocations and returns the scripted result', async () => {
    const tool = new MockTool(mockToolManifest({ id: 't1' }));
    const result = await tool.execute({ q: 'x' });
    expect(result.ok).toBe(true);
    expect(tool.invocations).toEqual([{ q: 'x' }]);
  });

  it('throws the configured error', async () => {
    const tool = new MockTool(mockToolManifest({ id: 't1', idempotent: true }));
    tool.throwError = new Error('boom');
    await expect(tool.execute({})).rejects.toThrow('boom');
  });
});

describe('MockToolExecutor', () => {
  it('records executions and returns the scripted result', async () => {
    const executor = new MockToolExecutor();
    const result = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
    });
    expect(result.toolId).toBe('t1');
    expect(executor.executions).toHaveLength(1);
  });
});

describe('FakeConversationStore', () => {
  it('seeds and loads conversations', async () => {
    const store = new FakeConversationStore();
    const conversation = store.seed({ tenantId: 't', userId: 'u' });
    expect(await store.load(conversation.id)).toBeDefined();
    expect(store.size).toBe(1);
  });

  it('appends turns', async () => {
    const store = new FakeConversationStore();
    const conversation = store.seed({ tenantId: 't', userId: 'u' });
    await store.appendTurn(conversation.id, {
      id: 'turn_1',
      role: 'user',
      content: 'hi',
      createdAt: nowIso(),
    });
    const loaded = await store.load(conversation.id);
    expect(loaded?.turns).toHaveLength(1);
  });
});
