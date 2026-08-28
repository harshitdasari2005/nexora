/**
 * @nexora/ai-runtime — Groq adapter.
 *
 * The Groq provider transport (AIR.md §1.2 R1 Enterprise AI, ADR-008): a
 * {@link ModelProvider} implementation that serves chat completions over
 * Groq's OpenAI-compatible `/chat/completions` endpoint. The runtime stays
 * provider-independent — this adapter is one registered implementation
 * behind the {@link ModelProvider} contract, resolved by the
 * {@link ProviderRegistry} at call time.
 *
 * The wire transport itself lives in `./openai-compatible-transport.js` and
 * is shared with every other OpenAI-compatible host (Ollama, vLLM, LM
 * Studio); this adapter only supplies Groq's identity, base URL, and its
 * requirement that an API key be present.
 */

import type { ChatRequest, ChatResponse } from '../providers/chat-provider.js';
import type { ModelProvider } from '../providers/model-provider.js';
import { completeOpenAICompatible } from './openai-compatible-transport.js';

/** Groq's OpenAI-compatible API base URL. */
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Options for the Groq adapter. */
export interface GroqAdapterOptions {
  /** The Groq model id to serve (e.g. `llama-3.3-70b-versatile`). */
  model: string;
  /** The Groq API key; required before completions can be served. */
  apiKey?: string;
  /** API base URL; defaults to Groq's OpenAI-compatible endpoint. */
  baseUrl?: string;
  /** Default sampling temperature, 0..2. Default 0.7. */
  temperature?: number;
}

/** The Groq provider adapter (chat capability). */
export class GroqAdapter implements ModelProvider {
  readonly id = 'groq';
  readonly name = 'Groq';
  readonly capabilities = ['chat'] as const;
  readonly models: readonly string[];
  readonly chat;

  constructor(options: GroqAdapterOptions) {
    this.models = [options.model];
    this.chat = {
      id: this.id,
      complete: (request: ChatRequest): Promise<ChatResponse> =>
        completeOpenAICompatible(
          {
            providerId: 'Groq',
            model: options.model,
            baseUrl: options.baseUrl ?? GROQ_BASE_URL,
            apiKey: options.apiKey,
            requireApiKey: true,
            apiKeyEnvVar: 'GROQ_API_KEY',
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          },
          request,
        ),
    };
  }
}
