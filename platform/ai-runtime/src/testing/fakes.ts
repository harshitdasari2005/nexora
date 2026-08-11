/**
 * @nexora/ai-runtime — fakes.
 *
 * Reference fakes for tests: an in-memory conversation store and an
 * in-memory memory provider.
 */

import type { Conversation, ConversationTurn } from '../conversation/conversation.js';
import type { ConversationStore } from '../conversation/conversation-store.js';
import { createConversation } from '../conversation/conversation-store.js';
import type {
  MemoryItem,
  MemoryProvider,
  MemoryQuery,
  MemoryResult,
  MemorySnapshot,
} from '@nexora/agent-sdk/memory';

/** An in-memory conversation store for tests. */
export class FakeConversationStore implements ConversationStore {
  readonly #conversations = new Map<string, Conversation>();

  async load(conversationId: string): Promise<Conversation | undefined> {
    return this.#conversations.get(conversationId);
  }

  async save(conversation: Conversation): Promise<void> {
    this.#conversations.set(conversation.id, conversation);
  }

  async appendTurn(conversationId: string, turn: ConversationTurn): Promise<void> {
    const conversation = this.#conversations.get(conversationId);
    if (conversation === undefined) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    this.#conversations.set(conversationId, {
      ...conversation,
      turns: [...conversation.turns, turn],
    });
  }

  /** Creates a conversation directly (test setup). */
  seed(input: { tenantId: string; userId: string; id?: string }): Conversation {
    const conversation = createConversation(input);
    this.#conversations.set(conversation.id, conversation);
    return conversation;
  }

  /** The number of stored conversations. */
  get size(): number {
    return this.#conversations.size;
  }
}

/** An in-memory memory provider for tests. */
export class FakeMemoryProvider implements MemoryProvider {
  readonly #items: MemoryItem[] = [];

  async store(item: MemoryItem): Promise<void> {
    this.#items.push(item);
  }

  async retrieve(query: MemoryQuery): Promise<MemoryResult> {
    const items = this.#items
      .filter(
        (item) =>
          query.text.length === 0 || item.content.toLowerCase().includes(query.text.toLowerCase()),
      )
      .slice(0, query.limit ?? 10);
    return { items, servedAt: new Date().toISOString() };
  }

  async snapshot(): Promise<MemorySnapshot> {
    return { agentId: 'runtime', items: [...this.#items], takenAt: new Date().toISOString() };
  }

  /** All stored items. */
  items(): readonly MemoryItem[] {
    return [...this.#items];
  }
}
