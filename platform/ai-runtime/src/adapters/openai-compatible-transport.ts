/**
 * @nexora/ai-runtime — OpenAI-compatible chat transport.
 *
 * The shared `/chat/completions` transport used by every provider that
 * speaks the OpenAI wire format — Groq, Ollama, vLLM, LM Studio, TGI, and
 * OpenAI itself. Vendor differences are configuration (base URL, whether an
 * API key is required), not code, so a self-hosted model is reached through
 * exactly the same tested path as a hosted one (ADR-008: the runtime stays
 * provider-independent). No vendor SDK is imported; the transport uses the
 * platform runtime's global `fetch`.
 *
 * Privacy note: the base URL is the ONLY thing that decides whether a
 * request leaves the deployment. Pointed at `http://localhost:11434/v1`
 * (Ollama) or an in-VPC vLLM endpoint, no prompt content — and therefore no
 * tenant data — crosses the network boundary.
 */

import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  TokenUsage,
} from '../providers/chat-provider.js';
import { ProviderError } from '../errors/index.js';

/** Configuration of one OpenAI-compatible chat endpoint. */
export interface OpenAICompatibleTransportOptions {
  /** Provider id used in error messages (e.g. `groq`, `ollama`). */
  providerId: string;
  /** The model id to serve (e.g. `llama-3.3-70b-versatile`, `llama3`). */
  model: string;
  /** The API base URL, including the version segment (e.g. `.../openai/v1`). */
  baseUrl: string;
  /** Bearer token. Required only when {@link requireApiKey} is true. */
  apiKey?: string;
  /**
   * Whether a non-empty {@link apiKey} is mandatory. Hosted providers set
   * this; local runtimes (Ollama, vLLM without auth) do not.
   */
  requireApiKey: boolean;
  /** The env var named in the "key missing" error, for an actionable message. */
  apiKeyEnvVar?: string;
  /** Default sampling temperature, 0..2. Default 0.7. */
  temperature?: number;
  /** Request timeout in milliseconds. Default 60s (local models are slower). */
  timeoutMs?: number;
  /**
   * Tokens added on top of a request's `maxTokens`. A reasoning model spends
   * part of its budget thinking before it writes; without headroom a small
   * budget comes back as an empty answer.
   */
  maxTokensHeadroom?: number;
  /** Extra provider-specific fields of the request body (e.g. `reasoning_effort`). */
  extraBody?: Readonly<Record<string, unknown>>;
}

/** A chat message in the OpenAI-compatible wire format. */
interface WireMessage {
  role: ChatMessage['role'];
  content: string;
}

/** The OpenAI-compatible completions payload. */
interface CompletionPayload {
  choices?: readonly { message?: { content?: unknown }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
}

/** Serves one chat completion through an OpenAI-compatible endpoint. */
export async function completeOpenAICompatible(
  options: OpenAICompatibleTransportOptions,
  request: ChatRequest,
): Promise<ChatResponse> {
  const apiKey = options.apiKey?.trim() ?? '';
  if (options.requireApiKey && apiKey.length === 0) {
    const envVar = options.apiKeyEnvVar === undefined ? '' : ` (${options.apiKeyEnvVar})`;
    throw new ProviderError(`${options.providerId} API key is not configured${envVar}`, {
      model: options.model,
    });
  }
  const url = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const timeoutMs = options.timeoutMs ?? 60_000;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Local runtimes ignore the header; sending it only when present
        // keeps unauthenticated endpoints (Ollama) clean.
        ...(apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: options.model,
        messages: request.messages.map(toWireMessage),
        temperature: request.temperature ?? options.temperature ?? 0.7,
        ...(request.maxTokens === undefined
          ? {}
          : { max_tokens: request.maxTokens + (options.maxTokensHeadroom ?? 0) }),
        ...options.extraBody,
        ...(request.stop === undefined || request.stop.length === 0
          ? {}
          : { stop: [...request.stop] }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // A known timeout is reported as one (telemetry classifies MODEL_TIMEOUT),
    // never as a generic transport failure.
    const timeout =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new ProviderError(
      `${options.providerId} request ${timeout ? 'timed out' : 'could not be sent'}`,
      {
        model: options.model,
        endpoint: url,
        cause: errorMessage(error),
        ...(timeout ? { timeout: true } : {}),
      },
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ProviderError(`${options.providerId} request failed with HTTP ${response.status}`, {
      model: options.model,
      detail: detail.slice(0, 300),
    });
  }

  const payload = (await response.json()) as CompletionPayload;
  const choice = payload.choices?.[0];
  if (choice === undefined || typeof choice.message?.content !== 'string') {
    throw new ProviderError(`${options.providerId} returned an empty completion`, {
      model: options.model,
    });
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

/** Normalizes a wire finish reason to the canonical set. */
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
