/**
 * @nexora/ai-runtime — Groq adapter.
 *
 * The Groq provider transport (AIR.md §1.2 R1 Enterprise AI, ADR-008): a
 * {@link ModelProvider} implementation that serves chat completions over
 * Groq's OpenAI-compatible `/chat/completions` endpoint. The runtime stays
 * provider-independent — this adapter is one registered implementation
 * behind the {@link ModelProvider} contract, resolved by the
 * {@link ProviderRegistry} at call time. No Groq SDK is imported; the
 * transport uses the platform runtime's global `fetch`.
 */

import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  TokenUsage,
} from '../providers/chat-provider.js';
import type { ModelProvider } from '../providers/model-provider.js';
import { ProviderError } from '../errors/index.js';

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
      complete: (request: ChatRequest): Promise<ChatResponse> => completeGroq(options, request),
    };
  }
}

/** A chat message in the OpenAI-compatible wire format. */
interface WireMessage {
  role: ChatMessage['role'];
  content: string;
}

/** The OpenAI-compatible completions payload returned by Groq. */
interface GroqCompletionPayload {
  choices?: readonly { message?: { content?: unknown }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
}

/** Serves one chat completion through the Groq API. */
async function completeGroq(
  options: GroqAdapterOptions,
  request: ChatRequest,
): Promise<ChatResponse> {
  if (options.apiKey === undefined || options.apiKey.trim().length === 0) {
    throw new ProviderError('Groq API key is not configured (GROQ_API_KEY)', {
      model: options.model,
    });
  }
  const baseUrl = options.baseUrl ?? 'https://api.groq.com/openai/v1';
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: request.messages.map(toWireMessage),
        temperature: request.temperature ?? options.temperature ?? 0.7,
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        ...(request.stop === undefined || request.stop.length === 0
          ? {}
          : { stop: [...request.stop] }),
      }),
    });
  } catch (error) {
    throw new ProviderError('Groq request could not be sent', {
      model: options.model,
      cause: errorMessage(error),
    });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ProviderError(`Groq request failed with HTTP ${response.status}`, {
      model: options.model,
      detail: detail.slice(0, 300),
    });
  }

  const payload = (await response.json()) as GroqCompletionPayload;
  const choice = payload.choices?.[0];
  if (choice === undefined || typeof choice.message?.content !== 'string') {
    throw new ProviderError('Groq returned an empty completion', { model: options.model });
  }

  return {
    content: choice.message.content,
    finishReason: toFinishReason(choice.finish_reason),
    usage: payload.usage === undefined ? undefined : toUsage(payload.usage),
    model: payload.model ?? options.model,
  };
}

/** Maps a runtime message to the OpenAI-compatible wire format. */
function toWireMessage(message: ChatMessage): WireMessage {
  return { role: message.role, content: message.content };
}

/** Normalizes a Groq finish reason to the canonical set. */
function toFinishReason(raw: string | undefined): ChatResponse['finishReason'] {
  if (raw === 'length') {
    return 'length';
  }
  if (raw === 'content_filter') {
    return 'content_filter';
  }
  return 'stop';
}

/** Maps the wire usage to the canonical {@link TokenUsage}. */
function toUsage(raw: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}): TokenUsage {
  const promptTokens = raw.prompt_tokens ?? 0;
  const completionTokens = raw.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: raw.total_tokens ?? promptTokens + completionTokens,
  };
}

/** Extracts a stable message from a caught error. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
