/**
 * @nexora/agent-sdk — memory.
 *
 * Generic memory interfaces (AIR.md §8). These are contracts only — the SDK
 * provides no implementation; domains and platform modules plug in concrete
 * stores. Interfaces are intentionally small and composable.
 */

/** A single memory item. */
export interface MemoryItem {
  /** Memory item id. */
  id: string;
  /** Content of the memory item. */
  content: string;
  /** Optional metadata (e.g. source, embedding id). */
  metadata?: Record<string, unknown>;
  /** ISO-8601 UTC time the item was created. */
  createdAt: string;
}

/** A memory retrieval query. */
export interface MemoryQuery {
  /** The query text. */
  text: string;
  /** Maximum number of items to return. */
  limit?: number;
  /** Optional filter over metadata. */
  filter?: Record<string, unknown>;
}

/** A memory retrieval result. */
export interface MemoryResult {
  /** Retrieved items, most relevant first. */
  items: readonly MemoryItem[];
  /** ISO-8601 UTC time the query was served. */
  servedAt: string;
}

/** A point-in-time snapshot of an agent's memory (for audit/export). */
export interface MemorySnapshot {
  /** The agent id the snapshot belongs to. */
  agentId: string;
  /** All memory items captured. */
  items: readonly MemoryItem[];
  /** ISO-8601 UTC time the snapshot was taken. */
  takenAt: string;
}

/** Short-term memory: recent, ephemeral working state. */
export interface ShortTermMemory {
  /** Stores an item. */
  store(item: MemoryItem): Promise<void>;
  /** Retrieves items matching the query. */
  retrieve(query: MemoryQuery): Promise<MemoryResult>;
  /** Clears short-term memory. */
  clear(): Promise<void>;
}

/** Long-term memory: durable, persisted state. */
export interface LongTermMemory {
  /** Stores an item. */
  store(item: MemoryItem): Promise<void>;
  /** Retrieves items matching the query. */
  retrieve(query: MemoryQuery): Promise<MemoryResult>;
  /** Deletes an item by id. */
  delete(id: string): Promise<void>;
}

/** Working memory: the scratchpad for the current execution. */
export interface WorkingMemory {
  /** Reads a value by key. */
  get(key: string): Promise<unknown | undefined>;
  /** Writes a value by key. */
  set(key: string, value: unknown): Promise<void>;
  /** Removes a key. */
  remove(key: string): Promise<void>;
}

/** Semantic memory: similarity-based retrieval over embedded knowledge. */
export interface SemanticMemory {
  /** Retrieves items semantically similar to the query. */
  search(query: MemoryQuery): Promise<MemoryResult>;
}

/**
 * A memory store: the persistence contract a concrete store implements.
 * Stores are generic over the memory kind they back.
 */
export interface MemoryStore {
  /** The store name, for observability. */
  readonly name: string;
  /** Stores an item. */
  store(item: MemoryItem): Promise<void>;
  /** Retrieves items matching the query. */
  retrieve(query: MemoryQuery): Promise<MemoryResult>;
  /** Deletes an item by id. */
  delete(id: string): Promise<void>;
}

/**
 * A memory provider: composes the memory kinds into one access point an
 * agent consumes.
 */
export interface MemoryProvider {
  /** Short-term memory, when available. */
  shortTerm?: ShortTermMemory;
  /** Long-term memory, when available. */
  longTerm?: LongTermMemory;
  /** Working memory for the current execution. */
  working?: WorkingMemory;
  /** Semantic memory, when available. */
  semantic?: SemanticMemory;

  /** Captures a snapshot of all memory (for audit/export). */
  snapshot(): Promise<MemorySnapshot>;
}
