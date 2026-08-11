/**
 * @nexora/ai-runtime — conversation tests.
 */

import { describe, expect, it } from 'vitest';

import {
  ConversationManager,
  HeadTailSummarizer,
} from '../src/conversation/conversation-manager.js';
import { InMemoryConversationStore } from '../src/conversation/conversation-store.js';

describe('ConversationManager', () => {
  it('opens a session and creates a conversation', async () => {
    const store = new InMemoryConversationStore();
    const manager = new ConversationManager(store);
    const session = await manager.openSession({ tenantId: 't', userId: 'u' });
    expect(session.status).toBe('active');
    expect(session.conversationId).toMatch(/^conv_/);
    expect(store.size).toBe(1);
  });

  it('reuses an existing conversation by id', async () => {
    const store = new InMemoryConversationStore();
    const manager = new ConversationManager(store);
    const first = await manager.openSession({ tenantId: 't', userId: 'u' });
    const second = await manager.openSession({
      tenantId: 't',
      userId: 'u',
      conversationId: first.conversationId,
    });
    expect(second.conversationId).toBe(first.conversationId);
    expect(store.size).toBe(1);
  });

  it('never attaches a conversation owned by another user (conversation security)', async () => {
    const store = new InMemoryConversationStore();
    const manager = new ConversationManager(store);
    const alice = await manager.openSession({ tenantId: 't', userId: 'alice' });
    await manager.addUserTurn(alice, 'alice secret');

    // Bob passes Alice's conversation id: he must get a FRESH conversation,
    // never read or extend Alice's history.
    const bob = await manager.openSession({
      tenantId: 't',
      userId: 'bob',
      conversationId: alice.conversationId,
    });
    expect(bob.conversationId).not.toBe(alice.conversationId);
    const aliceConversation = await store.load(alice.conversationId);
    expect(aliceConversation?.turns).toHaveLength(1);
    expect(aliceConversation?.turns[0]?.content).toBe('alice secret');
    const bobConversation = await store.load(bob.conversationId);
    expect(bobConversation?.turns).toHaveLength(0);
  });

  it('never attaches a conversation from another tenant', async () => {
    const store = new InMemoryConversationStore();
    const manager = new ConversationManager(store);
    const tenantA = await manager.openSession({ tenantId: 't_a', userId: 'u' });
    const tenantB = await manager.openSession({
      tenantId: 't_b',
      userId: 'u',
      conversationId: tenantA.conversationId,
    });
    expect(tenantB.conversationId).not.toBe(tenantA.conversationId);
  });

  it('does not attach a conversation scoped to a different workspace', async () => {
    const store = new InMemoryConversationStore();
    const manager = new ConversationManager(store);
    const ws1 = await manager.openSession({ tenantId: 't', userId: 'u', workspaceId: 'wsp_1' });
    const ws2 = await manager.openSession({
      tenantId: 't',
      userId: 'u',
      workspaceId: 'wsp_2',
      conversationId: ws1.conversationId,
    });
    expect(ws2.conversationId).not.toBe(ws1.conversationId);
  });

  it('treats an unknown conversation id as a fresh conversation (no id squatting)', async () => {
    const store = new InMemoryConversationStore();
    const manager = new ConversationManager(store);
    const session = await manager.openSession({
      tenantId: 't',
      userId: 'u',
      conversationId: 'conv_alien',
    });
    // The caller-supplied id is never reused: the fresh conversation gets a
    // generated id, so nobody can squat or predict conversation ids.
    expect(session.conversationId).not.toBe('conv_alien');
    expect(session.conversationId).toMatch(/^conv_/);
  });

  it('reuses a workspace-scoped conversation when the scope matches', async () => {
    const manager = new ConversationManager(new InMemoryConversationStore());
    const first = await manager.openSession({
      tenantId: 't',
      userId: 'u',
      workspaceId: 'wsp_1',
    });
    const second = await manager.openSession({
      tenantId: 't',
      userId: 'u',
      workspaceId: 'wsp_1',
      conversationId: first.conversationId,
    });
    expect(second.conversationId).toBe(first.conversationId);
  });

  it('never extends a foreign conversation even when the caller continues', async () => {
    const store = new InMemoryConversationStore();
    const manager = new ConversationManager(store);
    const alice = await manager.openSession({ tenantId: 't', userId: 'alice' });
    await manager.addUserTurn(alice, 'alice secret');

    // Bob passes Alice's id, then keeps chatting — his turns must go to his
    // own conversation, never Alice's.
    const bob = await manager.openSession({
      tenantId: 't',
      userId: 'bob',
      conversationId: alice.conversationId,
    });
    await manager.addUserTurn(bob, 'bob message');

    const aliceConversation = await store.load(alice.conversationId);
    expect(aliceConversation?.turns).toHaveLength(1);
    expect(aliceConversation?.turns[0]?.content).toBe('alice secret');
    const bobConversation = await store.load(bob.conversationId);
    expect(bobConversation?.turns.map((turn) => turn.role)).toEqual(['user']);
  });

  it('accumulates history across sessions only for the same scope', async () => {
    const store = new InMemoryConversationStore();
    const manager = new ConversationManager(store);
    const first = await manager.openSession({ tenantId: 't', userId: 'u' });
    await manager.addUserTurn(first, 'one');
    const second = await manager.openSession({
      tenantId: 't',
      userId: 'u',
      conversationId: first.conversationId,
    });
    await manager.addUserTurn(second, 'two');
    expect((await store.load(first.conversationId))?.turns).toHaveLength(2);
  });

  it('appends user and assistant turns to history', async () => {
    const manager = new ConversationManager(new InMemoryConversationStore());
    const session = await manager.openSession({ tenantId: 't', userId: 'u' });
    await manager.addUserTurn(session, 'hello');
    const history = await manager.addAssistantTurn(session, 'hi there');
    expect(history.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
  });

  it('bounds the history window and marks truncation', async () => {
    const manager = new ConversationManager(new InMemoryConversationStore(), { historyLimit: 2 });
    const session = await manager.openSession({ tenantId: 't', userId: 'u' });
    await manager.addUserTurn(session, 'one');
    await manager.addUserTurn(session, 'two');
    const history = await manager.addUserTurn(session, 'three');
    expect(history.truncated).toBe(true);
    expect(history.turns).toHaveLength(2);
    expect(history.turns[0]?.content).toBe('two');
  });

  it('rejects turns on closed sessions', async () => {
    const manager = new ConversationManager(new InMemoryConversationStore());
    const session = await manager.openSession({ tenantId: 't', userId: 'u' });
    manager.closeSession(session);
    await expect(manager.addUserTurn(session, 'x')).rejects.toThrow(/not active/);
  });

  it('throws when closing an unknown session', async () => {
    const manager = new ConversationManager(new InMemoryConversationStore());
    expect(() =>
      manager.closeSession({
        id: 'nope',
        conversationId: 'c',
        userId: 'u',
        status: 'active',
        startedAt: 'x',
      }),
    ).toThrow(/not found/);
  });

  it('summarizes with the default head/tail summarizer', async () => {
    const manager = new ConversationManager(new InMemoryConversationStore(), {
      summarizer: new HeadTailSummarizer(1, 1),
    });
    const session = await manager.openSession({ tenantId: 't', userId: 'u' });
    await manager.addUserTurn(session, 'one');
    await manager.addUserTurn(session, 'two');
    await manager.addUserTurn(session, 'three');
    const summary = await manager.summarize(session);
    expect(summary).toContain('one');
    expect(summary).toContain('three');
    expect(summary).toContain('…');
  });
});

describe('HeadTailSummarizer', () => {
  const turns = ['a', 'b', 'c', 'd', 'e'].map((content, index) => ({
    id: `turn_${index}`,
    role: 'user' as const,
    content,
    createdAt: `2026-08-08T00:00:0${index}.000Z`,
  }));

  it('returns everything when within budget', () => {
    const summarizer = new HeadTailSummarizer(3, 3);
    const summary = summarizer.summarize(turns.slice(0, 3));
    expect(summary).toContain('a');
    expect(summary).not.toContain('…');
  });

  it('returns empty for no turns', () => {
    expect(new HeadTailSummarizer().summarize([])).toBe('');
  });

  it('keeps head and tail when over budget', () => {
    const summary = new HeadTailSummarizer(2, 2).summarize(turns);
    expect(summary).toContain('a');
    expect(summary).toContain('b');
    expect(summary).toContain('d');
    expect(summary).toContain('e');
    expect(summary).not.toContain('c');
  });
});
