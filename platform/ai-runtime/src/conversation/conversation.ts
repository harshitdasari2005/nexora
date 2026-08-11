/**
 * @nexora/ai-runtime — conversation.
 *
 * Conversation entities (AIR.md §1.2 R13 Conversation Runtime): sessions,
 * turns, and the conversation itself. History is bounded and multi-turn
 * context is assembled from it (FR-7). These are plain data objects; the
 * {@link ConversationManager} owns the behavior.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** A single message in a conversation. */
export interface ConversationTurn {
  /** Turn id (`turn_...`). */
  id: string;
  /** The message role. */
  role: 'user' | 'assistant' | 'system';
  /** Message content. */
  content: string;
  /** ISO-8601 UTC time the turn occurred. */
  createdAt: string;
}

/** A conversation: the durable, tenant-scoped history container. */
export interface Conversation {
  /** Conversation id (`conv_...`). */
  id: string;
  /** Tenant the conversation belongs to. */
  tenantId: TenantId;
  /** The user the conversation belongs to. */
  userId: string;
  /** Workspace the conversation belongs to, when workspace-scoped. */
  workspaceId?: WorkspaceId;
  /** Turns, oldest first. */
  turns: readonly ConversationTurn[];
  /** ISO-8601 UTC time the conversation was created. */
  createdAt: string;
}

/** Lifecycle state of a conversation session. */
export type SessionStatus = 'active' | 'closed';

/** A conversation session: an active handle onto a conversation. */
export interface ConversationSession {
  /** Session id (`ses_...`). */
  id: string;
  /** The conversation the session belongs to. */
  conversationId: string;
  /** The user the session belongs to. */
  userId: string;
  /** Session lifecycle state. */
  status: SessionStatus;
  /** ISO-8601 UTC time the session started. */
  startedAt: string;
  /** ISO-8601 UTC time the session ended, when closed. */
  endedAt?: string;
}

/** A bounded view of conversation history (multi-turn context window). */
export interface ConversationHistory {
  /** The conversation id. */
  conversationId: string;
  /** Turns included in the window, oldest first. */
  turns: readonly ConversationTurn[];
  /** Whether older turns were truncated out of the window. */
  truncated: boolean;
}
