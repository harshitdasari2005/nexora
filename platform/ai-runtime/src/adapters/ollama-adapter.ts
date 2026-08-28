/**
 * @nexora/ai-runtime — Ollama (local model) adapter.
 *
 * The self-hosted provider transport (ADR-008, local models): serves chat
 * completions from a model running on infrastructure the deployment
 * controls — Ollama, or any other host that speaks the OpenAI-compatible
 * `/chat/completions` format (vLLM, LM Studio, TGI, llama.cpp's server).
 *
 * **This is the data-residency option.** With a local base URL, prompt
 * content — the user's utterance and the executed step results, which carry
 * real tenant records — never leaves the deployment's network. No API key
 * is required, because there is no third party to authenticate to. Nothing
 * else in the runtime changes: the orchestrator resolves this adapter
 * through the same {@link ModelProvider} contract as any hosted provider.
 */

import type { ChatRequest, ChatResponse } from '../providers/chat-provider.js';
import type { ModelProvider } from '../providers/model-provider.js';
import { completeOpenAICompatible } from './openai-compatible-transport.js';

/** Ollama's default OpenAI-compatible endpoint on the local host. */
const OLLAMA_BASE_URL = 'http://localhost:11434/v1';

/** Options for the Ollama adapter. */
export interface OllamaAdapterOptions {
  /** The local model id to serve (e.g. `llama3`, `qwen2.5`, `mistral`). */
  model: string;
  /**
   * The OpenAI-compatible base URL. Defaults to a local Ollama daemon.
   * Point this at any self-hosted endpoint (vLLM, LM Studio, TGI) to serve
   * the same contract from your own infrastructure.
   */
  baseUrl?: string;
  /** Bearer token, when the self-hosted endpoint sits behind a gateway. */
  apiKey?: string;
  /** Default sampling temperature, 0..2. Default 0.7. */
  temperature?: number;
  /**
   * Request timeout in milliseconds. Default 120s — a local model on CPU is
   * materially slower than a hosted accelerator, and a premature abort would
   * silently fall back to deterministic narration.
   */
  timeoutMs?: number;
}

/** The local-model provider adapter (chat capability). */
export class OllamaAdapter implements ModelProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama (local)';
  // Only `chat` is declared: token streaming is not implemented here, and
  // claiming the capability would let `resolveByCapability('streaming')`
  // hand a caller an adapter that cannot serve it.
  readonly capabilities = ['chat'] as const;
  readonly models: readonly string[];
  readonly chat;

  constructor(options: OllamaAdapterOptions) {
    this.models = [options.model];
    this.chat = {
      id: this.id,
      complete: (request: ChatRequest): Promise<ChatResponse> =>
        completeOpenAICompatible(
          {
            providerId: 'Ollama',
            model: options.model,
            baseUrl: options.baseUrl ?? OLLAMA_BASE_URL,
            // A local daemon needs no credential; forwarded only if given.
            ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
            requireApiKey: false,
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
            timeoutMs: options.timeoutMs ?? 120_000,
          },
          request,
        ),
    };
  }
}
