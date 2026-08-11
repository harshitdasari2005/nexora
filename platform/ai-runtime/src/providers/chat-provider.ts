/**
 * @nexora/ai-runtime — chat provider.
 *
 * The model-provider abstraction (AIR.md §1.2 R1 Enterprise AI, ADR-008):
 * a provider-independent chat completion contract. No provider is wired in
 * Phase 1 — concrete providers (OpenAI, Groq, Anthropic, Ollama) implement
 * this interface and are registered in the {@link ProviderRegistry}.
 */

/** A chat message role. */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** A single chat message. */
export interface ChatMessage {
  /** The message role. */
  role: ChatRole;
  /** The message content. */
  content: string;
  /** Tool call id, when the message is a tool result. */
  toolCallId?: string;
}

/** A chat completion request. */
export interface ChatRequest {
  /** The conversation messages. */
  messages: readonly ChatMessage[];
  /** Sampling temperature, 0..2. */
  temperature?: number;
  /** Maximum tokens to generate. */
  maxTokens?: number;
  /** Stop sequences. */
  stop?: readonly string[];
}

/** Token usage reported by a completion. */
export interface TokenUsage {
  /** Prompt tokens consumed. */
  promptTokens: number;
  /** Completion tokens consumed. */
  completionTokens: number;
  /** Total tokens consumed. */
  totalTokens: number;
}

/** A chat completion response. */
export interface ChatResponse {
  /** The generated content. */
  content: string;
  /** Why generation stopped. */
  finishReason: 'stop' | 'length' | 'content_filter' | 'error';
  /** Token usage, when reported. */
  usage?: TokenUsage;
  /** The model id that served the completion. */
  model: string;
}

/** The chat completion provider contract. */
export interface ChatProvider {
  /** Stable provider id, e.g. `openai`. */
  readonly id: string;
  /** Completes a chat request. */
  complete(request: ChatRequest): Promise<ChatResponse>;
}
