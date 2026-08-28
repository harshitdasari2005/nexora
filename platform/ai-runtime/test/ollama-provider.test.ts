/**
 * @nexora/ai-runtime — Ollama (local model) transport tests.
 *
 * The self-hosted adapter is tested against a stubbed global `fetch` — no
 * network, no daemon, no vendor SDK. The tests pin the properties that make
 * this the data-residency option: requests go to the configured LOCAL base
 * URL, no credential is invented when none is configured, and the response
 * maps onto the same {@link ChatResponse} contract every other provider
 * returns.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OllamaAdapter } from '../src/adapters/ollama-adapter.js';
import { ProviderError } from '../src/errors/index.js';

const MODEL = 'llama3';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stubs global fetch and returns the mock. */
function stubFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Builds a fake fetch Response with a JSON body. */
function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status });
}

describe('OllamaAdapter (local transport)', () => {
  it('declares its contract shape', () => {
    const adapter = new OllamaAdapter({ model: MODEL });
    expect(adapter.id).toBe('ollama');
    expect(adapter.capabilities).toEqual(['chat']);
    expect(adapter.models).toEqual([MODEL]);
    expect(adapter.chat).toBeDefined();
  });

  it('serves a completion with NO API key configured', async () => {
    stubFetch(
      jsonResponse(200, {
        model: MODEL,
        choices: [{ message: { content: 'Two projects need attention.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
      }),
    );
    const adapter = new OllamaAdapter({ model: MODEL });

    const result = await adapter.chat!.complete({
      messages: [{ role: 'user', content: 'Summarize' }],
    });

    expect(result.content).toBe('Two projects need attention.');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 8, totalTokens: 38 });
    expect(result.model).toBe(MODEL);
  });

  it('posts to the local daemon by default and sends no authorization header', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }));
    const adapter = new OllamaAdapter({ model: MODEL });

    await adapter.chat!.complete({ messages: [{ role: 'user', content: 'hi' }] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    // The privacy-critical assertion: the destination is loopback, and no
    // credential is fabricated for an endpoint that needs none.
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    const body = JSON.parse(init.body as string) as { model: string; messages: unknown[] };
    expect(body.model).toBe(MODEL);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('honors a self-hosted base URL (vLLM / LM Studio / TGI) and a gateway token', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }));
    const adapter = new OllamaAdapter({
      model: 'qwen2.5',
      baseUrl: 'https://models.internal.example/v1/',
      apiKey: 'gateway-token',
    });

    await adapter.chat!.complete({ messages: [{ role: 'user', content: 'hi' }] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://models.internal.example/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer gateway-token');
  });

  it('raises ProviderError on an HTTP error', async () => {
    stubFetch(jsonResponse(404, { error: 'model not found' }));
    const adapter = new OllamaAdapter({ model: 'missing-model' });
    await expect(
      adapter.chat!.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderError);
  });

  it('raises ProviderError when the daemon is unreachable', async () => {
    stubFetch(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
    const adapter = new OllamaAdapter({ model: MODEL });
    await expect(
      adapter.chat!.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderError);
  });

  it('raises ProviderError on an empty completion', async () => {
    stubFetch(jsonResponse(200, { choices: [] }));
    const adapter = new OllamaAdapter({ model: MODEL });
    await expect(
      adapter.chat!.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderError);
  });
});
