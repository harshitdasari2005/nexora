/**
 * @nexora/ai-runtime — conversation manager.
 *
 * Owns conversation sessions: creates sessions, appends turns, and assembles
 * bounded history for multi-turn context (AIR.md §1.2 R13, FR-7).
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type {
  Conversation,
  ConversationHistory,
  ConversationSession,
  ConversationTurn,
} from './conversation.js';
import type { ConversationStore } from './conversation-store.js';
import { createConversation } from './conversation-store.js';

/** Summarizes conversation history (AIR.md §8.4 MEM-7). */
export interface ConversationSummarizer {
  /** Summarizes the given turns into a single string. */
  summarize(turns: readonly ConversationTurn[]): Promise<string> | string;
}

/** A lossy summarizer that keeps the head and tail of the window. */
export class HeadTailSummarizer implements ConversationSummarizer {
  /**
   * @param headCount - turns kept from the start.
   * @param tailCount - turns kept from the end.
   */
  constructor(
    private readonly headCount = 3,
    private readonly tailCount = 3,
  ) {}

  summarize(turns: readonly ConversationTurn[]): string {
    if (turns.length === 0) {
      return '';
    }
    if (turns.length <= this.headCount + this.tailCount) {
      return turns.map((turn) => `${turn.role}: ${turn.content}`).join('\n');
    }
    const head = turns.slice(0, this.headCount);
    const tail = turns.slice(-this.tailCount);
    return [
      ...head,
      { id: 'summary', role: 'system' as const, content: '…', createdAt: '' },
      ...tail,
    ]
      .map((turn) => `${turn.role}: ${turn.content}`)
      .join('\n');
  }
}

/** Options for the {@link ConversationManager}. */
export interface ConversationManagerOptions {
  /** Maximum turns in the history window. Default 20. */
  historyLimit?: number;
  /** The summarizer used by {@link ConversationManager.summarize}. */
  summarizer?: ConversationSummarizer;
}

/** Manages conversation sessions and history windows. */
export class ConversationManager {
  readonly #store: ConversationStore;
  readonly #historyLimit: number;
  readonly #summarizer: ConversationSummarizer;
  readonly #sessions = new Map<string, ConversationSession>();

  constructor(store: ConversationStore, options: ConversationManagerOptions = {}) {
    this.#store = store;
    this.#historyLimit = options.historyLimit ?? 20;
    this.#summarizer = options.summarizer ?? new HeadTailSummarizer();
  }

  /** Opens a session for a conversation, creating the conversation when absent. */
  async openSession(input: {
    tenantId: string;
    userId: string;
    workspaceId?: string;
    conversationId?: string;
  }): Promise<ConversationSession> {
    const conversation = await this.#resolveConversation(input);
    const session: ConversationSession = {
      id: prefixedId('ses'),
      conversationId: conversation.id,
      userId: input.userId,
      status: 'active',
      startedAt: nowIso(),
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  /** Appends a user turn and returns the updated history window. */
  async addUserTurn(session: ConversationSession, content: string): Promise<ConversationHistory> {
    return this.addTurn(session, { role: 'user', content });
  }

  /** Appends an assistant turn and returns the updated history window. */
  async addAssistantTurn(
    session: ConversationSession,
    content: string,
  ): Promise<ConversationHistory> {
    return this.addTurn(session, { role: 'assistant', content });
  }

  /** Appends a turn to the session's conversation. */
  async addTurn(
    session: ConversationSession,
    turn: Pick<ConversationTurn, 'role' | 'content'>,
  ): Promise<ConversationHistory> {
    this.#assertActive(session);
    const full: ConversationTurn = { id: prefixedId('turn'), ...turn, createdAt: nowIso() };
    await this.#store.appendTurn(session.conversationId, full);
    return this.history(session);
  }

  /** Returns the bounded history window for a session. */
  async history(session: ConversationSession): Promise<ConversationHistory> {
    const conversation = await this.#store.load(session.conversationId);
    if (conversation === undefined) {
      return { conversationId: session.conversationId, turns: [], truncated: false };
    }
    const truncated = conversation.turns.length > this.#historyLimit;
    const window = conversation.turns.slice(-this.#historyLimit);
    return { conversationId: conversation.id, turns: window, truncated };
  }

  /** Summarizes the session's history (MEM-7). */
  async summarize(session: ConversationSession): Promise<string> {
    const history = await this.history(session);
    return this.#summarizer.summarize(history.turns);
  }

  /** Closes a session. */
  closeSession(session: ConversationSession): void {
    const existing = this.#sessions.get(session.id);
    if (existing === undefined) {
      throw new Error(`Session not found: ${session.id}`);
    }
    this.#sessions.set(session.id, { ...existing, status: 'closed', endedAt: nowIso() });
  }

  /** The session by id, when open. */
  session(id: string): ConversationSession | undefined {
    return this.#sessions.get(id);
  }

  #assertActive(session: ConversationSession): void {
    const current = this.#sessions.get(session.id);
    if (current === undefined || current.status !== 'active') {
      throw new Error(`Session is not active: ${session.id}`);
    }
  }

  async #resolveConversation(input: {
    tenantId: string;
    userId: string;
    workspaceId?: string;
    conversationId?: string;
  }): Promise<Conversation> {
    if (input.conversationId !== undefined) {
      const existing = await this.#store.load(input.conversationId);
      if (existing !== undefined && this.#ownedBy(existing, input)) {
        return existing;
      }
      // A foreign, mismatched, or unknown conversation id is NEVER attached:
      // the caller cannot read or extend another user's history, and the id
      // is never reused for a fresh conversation (conversation security
      // contract — AIR.md §8 R13 ownership).
    }
    const conversation = createConversation({
      tenantId: input.tenantId,
      userId: input.userId,
      workspaceId: input.workspaceId,
    });
    await this.#store.save(conversation);
    return conversation;
  }

  /**
   * Whether an existing conversation belongs to the requesting scope. A
   * conversation is owned by the (userId, tenantId, workspaceId) triple:
   * identity must match AND the workspace scope must match whenever EITHER
   * side carries one (strict equality, no asymmetric widening — a request
   * without a workspace scope never attaches to a workspace-scoped
   * conversation, and vice versa).
   */
  #ownedBy(
    conversation: Conversation,
    input: { tenantId: string; userId: string; workspaceId?: string },
  ): boolean {
    return (
      conversation.userId === input.userId &&
      conversation.tenantId === input.tenantId &&
      conversation.workspaceId === input.workspaceId
    );
  }
}
