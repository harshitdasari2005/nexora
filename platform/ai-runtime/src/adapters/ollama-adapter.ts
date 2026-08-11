/**
 * @nexora/ai-runtime — Ollama adapter.
 *
 * Contract placeholder (Phase 1): the Ollama (local model) provider adapter
 * *shape* is declared; the transport is wired in a later phase (ADR-008,
 * local models). Local/private deployment keeps the same contracts.
 */

import type { ChatRequest, ChatResponse } from '../providers/chat-provider.js';
import type { ModelProvider } from '../providers/model-provider.js';
import { ProviderError } from '../errors/index.js';

/** Options for the Ollama adapter. */
export interface OllamaAdapterOptions {
  /** The Ollama model id to serve (e.g. `llama3`). */
  model: string;
  /** Ollama base URL, e.g. `http://localhost:11434`. */
  baseUrl?: string;
}

/** The Ollama provider adapter (contract-only in Phase 1). */
export class OllamaAdapter implements ModelProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama';
  readonly capabilities = ['chat', 'streaming'] as const;
  readonly models: readonly string[];
  readonly chat;

  constructor(options: OllamaAdapterOptions) {
    this.models = [options.model];
    this.chat = {
      id: this.id,
      complete: (request: ChatRequest): Promise<ChatResponse> => {
        void request;
        return Promise.reject(
          new ProviderError(
            'Ollama adapter is a Phase 1 contract placeholder; the transport is not wired',
            { model: options.model, baseUrl: options.baseUrl },
          ),
        );
      },
    };
  }
}
