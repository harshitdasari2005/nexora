/**
 * @nexora/ai-runtime — Anthropic adapter.
 *
 * Contract placeholder (Phase 1): the Anthropic provider adapter *shape* is
 * declared; the transport is wired in a later phase (ADR-008).
 */

import type { ChatRequest, ChatResponse } from '../providers/chat-provider.js';
import type { ModelProvider } from '../providers/model-provider.js';
import { ProviderError } from '../errors/index.js';

/** Options for the Anthropic adapter. */
export interface AnthropicAdapterOptions {
  /** The Anthropic model id to serve (e.g. `claude-3-5-sonnet`). */
  model: string;
  /** API key; required before the adapter can be wired. */
  apiKey?: string;
}

/** The Anthropic provider adapter (contract-only in Phase 1). */
export class AnthropicAdapter implements ModelProvider {
  readonly id = 'anthropic';
  readonly execution = 'cloud' as const;
  readonly name = 'Anthropic';
  readonly capabilities = ['chat', 'streaming'] as const;
  readonly models: readonly string[];
  readonly chat;

  constructor(options: AnthropicAdapterOptions) {
    this.models = [options.model];
    this.chat = {
      id: this.id,
      complete: (request: ChatRequest): Promise<ChatResponse> => {
        void request;
        return Promise.reject(
          new ProviderError(
            'Anthropic adapter is a Phase 1 contract placeholder; the transport is not wired',
            { model: options.model },
          ),
        );
      },
    };
  }
}
