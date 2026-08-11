/**
 * @nexora/ai-runtime — streaming provider.
 *
 * The streaming abstraction (AI streaming UX, FRONTEND.md §6). Interface
 * only in Phase 1; concrete providers implement it when streaming lands.
 */

import type { ChatMessage } from './chat-provider.js';

/** A single streaming chunk. */
export interface StreamChunk {
  /** Incremental content, when produced. */
  content?: string;
  /** Whether the stream has finished. */
  done: boolean;
}

/** The streaming provider contract. */
export interface StreamingProvider {
  /** Stable provider id. */
  readonly id: string;
  /** Streams a completion for the messages. */
  stream(messages: readonly ChatMessage[]): AsyncIterable<StreamChunk>;
}
