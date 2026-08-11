/**
 * @nexora/ai-runtime — conversation store.
 *
 * The persistence port for conversations and sessions (AIR.md §1.2 R13).
 * The {@link InMemoryConversationStore} is the reference implementation; the
 * platform replaces it with a durable store behind the same contract.
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { Conversation, ConversationTurn } from './conversation.js';

/** The persistence port for conversations. */
export interface ConversationStore {
  /** Loads a conversation, or `undefined`. */
  load(conversationId: string): Promise<Conversation | undefined>;
  /** Saves a new conversation. */
  save(conversation: Conversation): Promise<void>;
  /** Appends a turn to a conversation. */
  appendTurn(conversationId: string, turn: ConversationTurn): Promise<void>;
}

/** An in-memory conversation store (tests and local development). */
export class InMemoryConversationStore implements ConversationStore {
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

  /** The number of stored conversations. */
  get size(): number {
    return this.#conversations.size;
  }
}

/** Builds a new conversation object. */
export function createConversation(input: {
  tenantId: string;
  userId: string;
  workspaceId?: string;
  id?: string;
}): Conversation {
  return {
    id: input.id ?? prefixedId('conv'),
    tenantId: input.tenantId as TenantId,
    userId: input.userId,
    workspaceId: input.workspaceId as WorkspaceId | undefined,
    turns: [],
    createdAt: nowIso(),
  };
}
