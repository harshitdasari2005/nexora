/**
 * @nexora/ai-runtime — embedding provider.
 *
 * The embedding abstraction (AIR.md §17 future: semantic memory, retrieval
 * ranking). Interface only in Phase 1; concrete providers implement it when
 * vector/embedding support lands.
 */

/** An embedding vector. */
export interface Embedding {
  /** The embedding vector. */
  vector: readonly number[];
  /** The source text the vector was computed from. */
  text?: string;
}

/** The embedding provider contract. */
export interface EmbeddingProvider {
  /** Stable provider id. */
  readonly id: string;
  /** Embeds the given texts. */
  embed(texts: readonly string[]): Promise<readonly Embedding[]>;
}
