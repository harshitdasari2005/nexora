/**
 * @nexora/ai-runtime — OpenAI adapter.
 *
 * Contract placeholder (Phase 1): the OpenAI provider adapter *shape* is
 * declared, but no transport is wired. Integrating the provider (ADR-008)
 * means implementing `chat.complete` against the OpenAI API — the runtime
 * contract stays unchanged.
 */

import type { ChatMessage, ChatRequest, ChatResponse } from '../providers/chat-provider.js';
import type { Embedding } from '../providers/embedding-provider.js';
import type { ModelProvider } from '../providers/model-provider.js';
import type { StreamChunk } from '../providers/streaming-provider.js';
import { ProviderError } from '../errors/index.js';

/** Options for the OpenAI adapter. */
export interface OpenAIAdapterOptions {
  /** The OpenAI model id to serve (e.g. `gpt-4o`). */
  model: string;
  /** API key; required before the adapter can be wired. */
  apiKey?: string;
  /** Base URL override. */
  baseUrl?: string;
}

/**
 * The OpenAI provider adapter (contract-only in Phase 1). Construction
 * validates the model; invocation throws {@link ProviderError} until the
 * transport is integrated.
 */
export class OpenAIAdapter implements ModelProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';
  readonly capabilities = ['chat', 'embedding', 'streaming'] as const;
  readonly models: readonly string[];
  readonly chat;
  readonly embedding;
  readonly streaming;

  constructor(options: OpenAIAdapterOptions) {
    this.models = [options.model];
    this.chat = {
      id: this.id,
      complete: (request: ChatRequest): Promise<ChatResponse> => {
        void request;
        return Promise.reject(
          new ProviderError(
            'OpenAI adapter is a Phase 1 contract placeholder; the transport is not wired',
            { model: options.model },
          ),
        );
      },
    };
    this.embedding = {
      id: this.id,
      embed: (texts: readonly string[]): Promise<readonly Embedding[]> => {
        void texts;
        return Promise.reject(
          new ProviderError(
            'OpenAI adapter is a Phase 1 contract placeholder; the transport is not wired',
            { model: options.model },
          ),
        );
      },
    };
    this.streaming = {
      id: this.id,
      stream: (_messages: readonly ChatMessage[]): AsyncIterable<StreamChunk> => {
        return {
          async *[Symbol.asyncIterator]() {
            throw new ProviderError(
              'OpenAI adapter is a Phase 1 contract placeholder; the transport is not wired',
            );
          },
        };
      },
    };
  }
}
