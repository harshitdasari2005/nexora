/**
 * @nexora/ai-runtime — memory.
 *
 * Memory contracts (AIR.md §8). The runtime reuses the Agent SDK's generic
 * memory interfaces (`@nexora/agent-sdk/memory`) and adds the scoped views
 * the orchestrator needs: conversation and workspace memory. Interfaces only
 * — concrete stores (incl. vector stores) plug in at the platform boundary;
 * no vector database is implemented here.
 */

import type {
  MemoryItem as AgentMemoryItem,
  MemoryQuery as AgentMemoryQuery,
  MemoryResult as AgentMemoryResult,
} from '@nexora/agent-sdk/memory';

export type {
  LongTermMemory,
  MemoryItem,
  MemoryProvider,
  MemoryQuery,
  MemoryResult,
  MemorySnapshot,
  MemoryStore,
  SemanticMemory,
  ShortTermMemory,
  WorkingMemory,
} from '@nexora/agent-sdk/memory';

export type {
  MemoryItem as RuntimeMemoryItem,
  MemoryQuery as RuntimeMemoryQuery,
} from '@nexora/agent-sdk/memory';

/** Memory scopes (AIR.md §8.1). */
export type MemoryScope = 'conversation' | 'user' | 'workspace' | 'company' | 'agent' | 'workflow';

/** A read/write view scoped to one conversation (AIR.md §8.1 session memory). */
export interface ConversationMemory {
  /** Reads from the conversation's memory. */
  read(conversationId: string, query: AgentMemoryQuery): Promise<AgentMemoryResult>;
  /** Writes an item to the conversation's memory. */
  write(conversationId: string, item: AgentMemoryItem): Promise<void>;
}

/** A read/write view scoped to one workspace (AIR.md §8.1 workspace memory). */
export interface WorkspaceMemory {
  /** Reads from the workspace's memory. */
  read(workspaceId: string, query: AgentMemoryQuery): Promise<AgentMemoryResult>;
  /** Writes an item to the workspace's memory. */
  write(workspaceId: string, item: AgentMemoryItem): Promise<void>;
}
