/**
 * @nexora/ai-runtime — mock provider.
 *
 * A configurable {@link ModelProvider} for tests: scripted completions,
 * embeddings, and streams.
 */

import type { ChatMessage, ChatRequest, ChatResponse } from '../providers/chat-provider.js';
import type { Embedding } from '../providers/embedding-provider.js';
import type { ModelProvider, ProviderCapability } from '../providers/model-provider.js';
import type { StreamChunk } from '../providers/streaming-provider.js';

/** A mock chat provider with scripted responses. */
export class MockChatProvider {
  /** Stable provider id. */
  readonly id = 'mock-chat';
  /** Completions served. */
  completions: ChatRequest[] = [];
  /** The response to return. */
  response: ChatResponse = {
    content: 'mock completion',
    finishReason: 'stop',
    model: 'mock',
  };

  async complete(request: ChatRequest): Promise<ChatResponse> {
    this.completions.push(request);
    return this.response;
  }
}

/** A mock embedding provider. */
export class MockEmbeddingProvider {
  /** Stable provider id. */
  readonly id = 'mock-embedding';
  /** Texts embedded. */
  texts: readonly string[] = [];

  async embed(texts: readonly string[]): Promise<readonly Embedding[]> {
    this.texts = texts;
    return texts.map((text, index) => ({ vector: [index], text }));
  }
}

/** A mock streaming provider. */
export class MockStreamingProvider {
  /** Stable provider id. */
  readonly id = 'mock-streaming';
  /** Chunks to stream. */
  chunks: readonly StreamChunk[] = [{ content: 'mock', done: false }, { done: true }];

  stream(_messages: readonly ChatMessage[]): AsyncIterable<StreamChunk> {
    const chunks = this.chunks;
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield chunk;
        }
      },
    };
  }
}

/** A mock model provider combining the mock capabilities. */
export class MockModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly models: readonly string[];
  readonly chat: MockChatProvider;
  readonly embedding: MockEmbeddingProvider;
  readonly streaming: MockStreamingProvider;

  constructor(
    input: {
      id?: string;
      name?: string;
      capabilities?: readonly ProviderCapability[];
      response?: ChatResponse;
    } = {},
  ) {
    this.id = input.id ?? 'mock';
    this.name = input.name ?? 'Mock Provider';
    this.capabilities = input.capabilities ?? ['chat', 'embedding', 'streaming'];
    this.models = ['mock-model'];
    this.chat = new MockChatProvider();
    this.embedding = new MockEmbeddingProvider();
    this.streaming = new MockStreamingProvider();
    if (input.response !== undefined) {
      this.chat.response = input.response;
    }
  }
}
